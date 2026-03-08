const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const crypto = require('crypto');

const { BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WPAY_STORE_API_KEY } = process.env;

// UI Text Dictionary
const UI = {
    ru: {
        stars_plans: "Оплата Звездами ⭐",
        crypto_plans: "Оплата Криптой 💎",
        get_promo: "🎁 Промо (24ч)",
        plan_7d: "7 дней",
        plan_1m: "1 месяц",
        plan_1y: "1 год",
        promo_used: "❌ Вы уже использовали промо-период.",
        crypto_info: "Выберите подходящий тариф. После успешной оплаты вы сразу получите лицензионный ключ для активации расширения.",
        success_payment: "✅ Оплата прошла успешно!\n\nТвой лицензионный ключ (${duration}):\n`${key}`\n\nВставь его в настройки расширения.",
        success_trial: "🎁 Тебе выдан пробный ключ на 24 часа!\n\nКлюч:\n`${key}`\n\nПоспеши использовать!",
        welcome_default: "Привет! Я бот Threads AI. Выбери тарифный план ниже. Сразу после оплаты ты получишь лицензионный ключ для работы в расширении:"
    },
    en: {
        stars_plans: "Pay with Stars ⭐",
        crypto_plans: "Pay with Crypto 💎",
        get_promo: "🎁 Promo (24h)",
        plan_7d: "7 days",
        plan_1m: "1 month",
        plan_1y: "1 year",
        promo_used: "❌ You have already used your promo period.",
        crypto_info: "Select a plan. After successful payment, you will immediately receive a license key to activate the extension.",
        success_payment: "✅ Payment successful!\n\nYour license key (${duration}):\n`${key}`\n\nPaste it into the extension settings.",
        success_trial: "🎁 You received a 24h trial key!\n\nKey:\n`${key}`\n\nUse it now!",
        welcome_default: "Hi! I am the Threads AI Bot. Choose your plan below. You will receive your license key immediately after successful payment:"
    }
};

// Subscription plans
const PLANS = {
    "7d": { stars: 100, crypto_val: "1.5", days: 7, label_ru: "7 дней", label_en: "7 days" },
    "1m": { stars: 400, crypto_val: "6", days: 30, label_ru: "1 месяц", label_en: "1 month" },
    "1y": { stars: 4000, crypto_val: "60", days: 365, label_ru: "1 год", label_en: "1 year" }
};

module.exports = async (req, res) => {
    const startTime = Date.now();
    console.log(`[BOT] Inbound Update: ${req.method} ${req.url}`);

    try {
        // 0. Handle Wallet Pay Webhook (Direct POST from Wallet Pay)
        const wpaySignature = req.headers['walletpay-signature'];
        if (wpaySignature && WPAY_STORE_API_KEY) {
            console.log('[WPAY] Callback detected, verifying signature...');
            const bodyStr = JSON.stringify(req.body);
            const timestamp = req.headers['walletpay-timestamp'];
            const method = req.method;
            const path = req.url; // Usually /api/webhook or /

            // Verify Signature: HTTP-method.URI-path.timestamp.Base-64-encoded-body
            const base64Body = Buffer.from(bodyStr).toString('base64');
            const signStr = `${method}.${path}.${timestamp}.${base64Body}`;
            const expectedSign = crypto.createHmac('sha256', WPAY_STORE_API_KEY).update(signStr).digest('base64');

            if (wpaySignature === expectedSign) {
                console.log('[WPAY] Signature verified. Processing updates...');
                const updates = req.body; // Array of updates
                const client = getSupabase();

                try {
                    for (const update of updates) {
                        if (update.type === 'ORDER_PAID') {
                            const order = update.payload;
                            const { externalId, customerTelegramUserId } = order;
                            console.log(`[WPAY] Order paid: ${externalId} for user ${customerTelegramUserId}`);

                            const planId = externalId.split('_')[1];
                            const plan = PLANS[planId] || PLANS["1y"];

                            // Mark payment completed
                            console.time(`WPAY_DB_UPDATE_PAYMENT_${externalId}`);
                            await client.from('payments').update({ status: 'completed', provider_payload: order }).eq('provider_payment_charge_id', externalId);
                            console.timeEnd(`WPAY_DB_UPDATE_PAYMENT_${externalId}`);

                            // Issue license
                            const licenseKey = `TH-CRYPTO-${planId.toUpperCase()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                            const expiresAt = new Date();
                            expiresAt.setDate(expiresAt.getDate() + plan.days);

                            console.time(`WPAY_DB_INSERT_LICENSE_${externalId}`);
                            await client.from('licenses').insert({
                                license_key: licenseKey,
                                user_id: customerTelegramUserId,
                                expires_at: expiresAt.toISOString(),
                                status: 'active'
                            });
                            console.timeEnd(`WPAY_DB_INSERT_LICENSE_${externalId}`);

                            // UI lookup (needs lang, we might need to fetch user lang from DB)
                            console.time(`WPAY_DB_FETCH_USER_LANG_${customerTelegramUserId}`);
                            const { data: user } = await client.from('users').select('language_code').eq('id', customerTelegramUserId).maybeSingle();
                            console.timeEnd(`WPAY_DB_FETCH_USER_LANG_${customerTelegramUserId}`);
                            const lang = user?.language_code || 'en';
                            const durationText = lang === 'ru' ? plan.label_ru : plan.label_en;

                            console.log(`[WPAY] Sending success message to user ${customerTelegramUserId}`);
                            await sendTG('sendMessage', {
                                chat_id: customerTelegramUserId,
                                text: UI[lang].success_payment.replace('${duration}', durationText).replace('${key}', licenseKey),
                                parse_mode: 'Markdown'
                            });
                            console.log(`[WPAY] Success message sent to user ${customerTelegramUserId}`);
                        }
                    }
                    console.log(`[WPAY] Done. Handled in ${Date.now() - startTime}ms`);
                    return res.status(200).json({ ok: true });
                } catch (wpayError) {
                    console.error('[WPAY] Error processing updates:', wpayError.stack || wpayError.message);
                    return res.status(500).json({ ok: false, error: 'Wallet Pay webhook processing failed' });
                }
            }
            console.warn('[WPAY] Signature mismatch');
            return res.status(403).end();
        }

        if (req.method !== 'POST') {
            console.log('[BOT] Active polling or manual ping');
            return res.status(200).send('Bot Status: Online');
        }

        const update = req.body;
        if (!update || !update.update_id) return res.status(200).end();

        const from = update.message?.from || update.callback_query?.from || update.pre_checkout_query?.from;
        if (!from) return res.status(200).end();

        const lang = (from.language_code || 'en').startsWith('ru') ? 'ru' : 'en';
        const texts = UI[lang];

        const client = getSupabase();

        // 1. Handle /start
        if (update.message && update.message.text === '/start') {
            const { id, username, first_name, last_name } = from;
            const fullName = `${first_name || ''} ${last_name || ''}`.trim();
            console.log(`[/start] User: ${id} (${username})`);

            console.time(`DB_UPSERT_USER_${id}`);
            await client.from('users').upsert({
                id: id,
                username: username,
                full_name: fullName,
                language_code: lang
            });

            const { data: settings } = await client
                .from('bot_settings')
                .select('value')
                .eq('key', `welcome_message_${lang}`)
                .maybeSingle();
            console.timeEnd(`DB_UPSERT_USER_${id}`);

            console.log(`[TG] Sending welcome message to user ${id}`);
            await sendTG('sendMessage', {
                chat_id: id,
                text: settings ? settings.value : texts.welcome_default,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: texts.stars_plans, callback_data: "menu_stars" }],
                        [{ text: texts.crypto_plans, callback_data: "menu_crypto" }],
                        [{ text: texts.get_promo, callback_data: "pay_trial" }]
                    ]
                }
            });
            console.log(`[TG] Welcome message sent to user ${id}`);
        }

        // 2. Handle Button Clicks
        if (update.callback_query) {
            const { data, id: queryId, message } = update.callback_query;
            console.log(`[BUTTON] Data: ${data} from: ${from.id}`);

            if (data === 'menu_stars') {
                console.log(`[TG] Editing message for user ${from.id} to show stars plans`);
                await sendTG('editMessageText', {
                    chat_id: from.id,
                    message_id: message.message_id,
                    text: texts.stars_plans,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `⭐ 100 — ${texts.plan_7d}`, callback_data: "buy_stars_7d" }],
                            [{ text: `⭐ 400 — ${texts.plan_1m}`, callback_data: "buy_stars_1m" }],
                            [{ text: `⭐ 4000 — ${texts.plan_1y}`, callback_data: "buy_stars_1y" }],
                            [{ text: "« Назад", callback_data: "menu_back" }]
                        ]
                    }
                });
                console.log(`[TG] Message edited for user ${from.id}`);
            }

            if (data === 'menu_crypto') {
                console.log(`[TG] Editing message for user ${from.id} to show crypto plans`);
                await sendTG('editMessageText', {
                    chat_id: from.id,
                    message_id: message.message_id,
                    text: texts.crypto_info,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `💎 USDT ${PLANS["7d"].crypto_val} — ${texts.plan_7d}`, callback_data: "buy_crypto_7d" }],
                            [{ text: `💎 USDT ${PLANS["1m"].crypto_val} — ${texts.plan_1m}`, callback_data: "buy_crypto_1m" }],
                            [{ text: `💎 USDT ${PLANS["1y"].crypto_val} — ${texts.plan_1y}`, callback_data: "buy_crypto_1y" }],
                            [{ text: "« Назад", callback_data: "menu_back" }]
                        ]
                    }
                });
                console.log(`[TG] Message edited for user ${from.id}`);
            }

            if (data === 'menu_back') {
                console.log(`[TG] Editing message for user ${from.id} to show main menu`);
                await sendTG('editMessageText', {
                    chat_id: from.id,
                    message_id: message.message_id,
                    text: texts.welcome_default,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: texts.stars_plans, callback_data: "menu_stars" }],
                            [{ text: texts.crypto_plans, callback_data: "menu_crypto" }],
                            [{ text: texts.get_promo, callback_data: "pay_trial" }]
                        ]
                    }
                });
                console.log(`[TG] Message edited for user ${from.id}`);
            }

            if (data.startsWith('buy_stars_')) {
                const planId = data.replace('buy_stars_', '');
                const plan = PLANS[planId];
                const invoicePayload = `plan_${planId}_${from.id}_${Date.now()}`;

                console.time(`DB_INSERT_PAYMENT_STARS_${from.id}`);
                await client.from('payments').insert({
                    user_id: from.id,
                    amount: plan.stars,
                    currency: 'stars',
                    status: 'pending',
                    provider_payment_charge_id: invoicePayload
                });
                console.timeEnd(`DB_INSERT_PAYMENT_STARS_${from.id}`);

                console.log(`[TG] Sending invoice for stars plan ${planId} to user ${from.id}`);
                await sendTG('sendInvoice', {
                    chat_id: from.id,
                    title: lang === 'ru' ? `Доступ на ${plan.label_ru}` : `${plan.label_en} Access`,
                    description: lang === 'ru' ? "Полный доступ к Threads AI" : "Full access to Threads AI",
                    payload: invoicePayload,
                    provider_token: "",
                    currency: "XTR",
                    prices: [{ label: "License", amount: plan.stars }]
                });
                console.log(`[TG] Invoice sent for stars plan ${planId} to user ${from.id}`);
            }

            if (data.startsWith('buy_crypto_')) {
                const planId = data.replace('buy_crypto_', '');
                const plan = PLANS[planId];
                const externalId = `wpay_${planId}_${from.id}_${Date.now()}`;

                if (!WPAY_STORE_API_KEY) {
                    console.log(`[TG] Answering callback query ${queryId} with Wallet Pay not configured alert`);
                    await sendTG('answerCallbackQuery', { callback_query_id: queryId, text: "Wallet Pay is not configured on server.", show_alert: true });
                    return res.status(200).json({ ok: true });
                }

                // Create Wallet Pay Order
                console.log(`[WPAY] Creating order for user ${from.id} with externalId ${externalId}`);
                console.time(`FETCH_WPAY_ORDER_${externalId}`);
                const wpayRes = await fetch('https://pay.wallet.tg/wpay/store-api/v1/order', {
                    method: 'POST',
                    headers: {
                        'Wpay-Store-Api-Key': WPAY_STORE_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        amount: { currencyCode: "USDT", amount: plan.crypto_val },
                        description: `Threads AI - ${plan.label_en}`,
                        externalId: externalId,
                        timeoutSeconds: 3600,
                        customerTelegramUserId: from.id
                    })
                }).then(r => r.json());
                console.timeEnd(`FETCH_WPAY_ORDER_${externalId}`);

                if (wpayRes.status === 'SUCCESS') {
                    console.time(`DB_INSERT_PAYMENT_CRYPTO_${from.id}`);
                    await client.from('payments').insert({
                        user_id: from.id,
                        amount: parseFloat(plan.crypto_val) * 100, // as cents usually
                        currency: 'usdt',
                        status: 'pending',
                        provider_payment_charge_id: externalId
                    });
                    console.timeEnd(`DB_INSERT_PAYMENT_CRYPTO_${from.id}`);

                    console.log(`[TG] Sending Wallet Pay link to user ${from.id}`);
                    await sendTG('sendMessage', {
                        chat_id: from.id,
                        text: lang === 'ru' ? "Оплатите заказ по ссылке:" : "Please pay via the link:",
                        reply_markup: {
                            inline_keyboard: [[{ text: "Open Wallet", url: wpayRes.data.payLink }]]
                        }
                    });
                    console.log(`[TG] Wallet Pay link sent to user ${from.id}`);
                } else {
                    console.error('[WPAY] Order creation failed:', wpayRes);
                    console.log(`[TG] Answering callback query ${queryId} with Wallet Pay error alert`);
                    await sendTG('answerCallbackQuery', { callback_query_id: queryId, text: "Order creation failed.", show_alert: true });
                }
            }

            if (data === 'pay_trial') {
                console.time(`DB_FETCH_USER_TRIAL_${from.id}`);
                const { data: user } = await client.from('users').select('trial_used').eq('id', from.id).maybeSingle();
                console.timeEnd(`DB_FETCH_USER_TRIAL_${from.id}`);
                if (user?.trial_used) {
                    console.log(`[TG] User ${from.id} already used promo, sending alert`);
                    await sendTG('sendMessage', { chat_id: from.id, text: texts.promo_used });
                    await sendTG('answerCallbackQuery', { callback_query_id: queryId });
                    return res.status(200).json({ ok: true });
                }

                const trialKey = `TH-TRIAL-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                const expiresAt = new Date();
                expiresAt.setHours(expiresAt.getHours() + 24);

                console.time(`DB_INSERT_TRIAL_LICENSE_${from.id}`);
                const { error: licError } = await client.from('licenses').insert({
                    license_key: trialKey,
                    user_id: from.id,
                    expires_at: expiresAt.toISOString(),
                    status: 'active'
                });
                console.timeEnd(`DB_INSERT_TRIAL_LICENSE_${from.id}`);

                if (!licError) {
                    console.time(`DB_UPDATE_USER_TRIAL_USED_${from.id}`);
                    await client.from('users').update({ trial_used: true }).eq('id', from.id);
                    console.timeEnd(`DB_UPDATE_USER_TRIAL_USED_${from.id}`);
                    console.log(`[TG] Sending trial key to user ${from.id}`);
                    await sendTG('sendMessage', { chat_id: from.id, text: texts.success_trial.replace('${key}', trialKey), parse_mode: 'Markdown' });
                    console.log(`[TG] Trial key sent to user ${from.id}`);
                } else {
                    console.error(`[DB] Error inserting trial license for user ${from.id}:`, licError);
                }
            }
            console.log(`[TG] Answering callback query ${queryId}`);
            await sendTG('answerCallbackQuery', { callback_query_id: queryId });
            console.log(`[TG] Callback query ${queryId} answered`);
        }

        // 3. Handle Pre-checkout
        if (update.pre_checkout_query) {
            console.log(`[TG] Answering pre-checkout query ${update.pre_checkout_query.id}`);
            await sendTG('answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: true });
            console.log(`[TG] Pre-checkout query ${update.pre_checkout_query.id} answered`);
        }

        // 4. Handle Successful Payment (Stars)
        if (update.message && update.message.successful_payment) {
            const sp = update.message.successful_payment;
            const payload = sp.invoice_payload;
            const planId = payload.split('_')[1];
            const plan = PLANS[planId] || PLANS["1y"];
            console.log(`[TG] Successful stars payment for user ${from.id}, plan ${planId}`);

            console.time(`DB_INSERT_SUCCESS_PAYMENT_STARS_${from.id}`);
            await client.from('payments').insert({
                user_id: from.id,
                amount: sp.total_amount,
                currency: 'stars',
                status: 'completed',
                provider_payment_charge_id: sp.invoice_payload,
                provider_payload: sp
            });
            console.timeEnd(`DB_INSERT_SUCCESS_PAYMENT_STARS_${from.id}`);

            const licenseKey = `TH-${planId.toUpperCase()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + plan.days);

            console.time(`DB_INSERT_LICENSE_STARS_${from.id}`);
            await client.from('licenses').insert({
                license_key: licenseKey,
                user_id: from.id,
                expires_at: expiresAt.toISOString(),
                status: 'active'
            });
            console.timeEnd(`DB_INSERT_LICENSE_STARS_${from.id}`);

            const durationText = lang === 'ru' ? plan.label_ru : plan.label_en;
            console.log(`[TG] Sending stars payment success message to user ${from.id}`);
            await sendTG('sendMessage', {
                chat_id: from.id,
                text: texts.success_payment.replace('${duration}', durationText).replace('${key}', licenseKey),
                parse_mode: 'Markdown'
            });
            console.log(`[TG] Stars payment success message sent to user ${from.id}`);
        }

        console.log(`[BOT] Finished handling update in ${Date.now() - startTime}ms`);
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(`[CRITICAL] Runtime error after ${Date.now() - startTime}ms:`, error.stack || error.message);
        res.status(200).json({ ok: false, error: 'Internal operation failed' });
    }
};

async function sendTG(method, body) {
    if (!BOT_TOKEN) return { ok: false };
    console.log(`[TG_API] Calling method: ${method}`);
    console.time(`FETCH_TG_API_${method}`);
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).then(r => r.json());
    console.timeEnd(`FETCH_TG_API_${method}`);
    if (!res.ok) console.error(`[TG_ERR] ${method}:`, res.description);
    return res;
}

const getSupabase = () => {
    if (!supabase) {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error('Supabase Env Vars missing');
        }
        console.log('[SUPABASE] Initializing client');
        console.time('SUPABASE_INIT');
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        console.timeEnd('SUPABASE_INIT');
    }
    return supabase;
};
let supabase;
