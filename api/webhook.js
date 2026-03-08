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
    // 0. Handle Wallet Pay Webhook (Direct POST from Wallet Pay)
    const wpaySignature = req.headers['walletpay-signature'];
    if (wpaySignature && WPAY_STORE_API_KEY) {
        const bodyStr = JSON.stringify(req.body);
        const timestamp = req.headers['walletpay-timestamp'];
        const method = req.method;
        const path = req.url; // Usually /api/webhook or /

        // Verify Signature: HTTP-method.URI-path.timestamp.Base-64-encoded-body
        const base64Body = Buffer.from(bodyStr).toString('base64');
        const signStr = `${method}.${path}.${timestamp}.${base64Body}`;
        const expectedSign = crypto.createHmac('sha256', WPAY_STORE_API_KEY).update(signStr).digest('base64');

        if (wpaySignature === expectedSign) {
            const updates = req.body; // Array of updates
            const client = getSupabase();

            for (const update of updates) {
                if (update.type === 'ORDER_PAID') {
                    const order = update.payload;
                    const { externalId, customerTelegramUserId } = order;
                    const planId = externalId.split('_')[1];
                    const plan = PLANS[planId] || PLANS["1y"];

                    // Mark payment completed
                    await client.from('payments').update({ status: 'completed', provider_payload: order }).eq('provider_payment_charge_id', externalId);

                    // Issue license
                    const licenseKey = `TH-CRYPTO-${planId.toUpperCase()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                    const expiresAt = new Date();
                    expiresAt.setDate(expiresAt.getDate() + plan.days);

                    await client.from('licenses').insert({
                        license_key: licenseKey,
                        user_id: customerTelegramUserId,
                        expires_at: expiresAt.toISOString(),
                        status: 'active'
                    });

                    // UI lookup (needs lang, we might need to fetch user lang from DB)
                    const { data: user } = await client.from('users').select('language_code').eq('id', customerTelegramUserId).maybeSingle();
                    const lang = user?.language_code || 'en';
                    const durationText = lang === 'ru' ? plan.label_ru : plan.label_en;

                    await sendTG('sendMessage', {
                        chat_id: customerTelegramUserId,
                        text: UI[lang].success_payment.replace('${duration}', durationText).replace('${key}', licenseKey),
                        parse_mode: 'Markdown'
                    });
                }
            }
            return res.status(200).json({ ok: true });
        }
        console.warn('WPay Signature Mismatch');
        return res.status(403).end();
    }

    if (req.method !== 'POST') return res.status(200).send('Bot Status: Online');

    const update = req.body;
    if (!update || !update.update_id) return res.status(200).end();

    const from = update.message?.from || update.callback_query?.from || update.pre_checkout_query?.from;
    if (!from) return res.status(200).end();

    const lang = (from.language_code || 'en').startsWith('ru') ? 'ru' : 'en';
    const texts = UI[lang];

    try {
        const client = getSupabase();

        // 1. Handle /start
        if (update.message && update.message.text === '/start') {
            const { id, username, first_name, last_name } = from;
            const fullName = `${first_name || ''} ${last_name || ''}`.trim();

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
        }

        // 2. Handle Button Clicks
        if (update.callback_query) {
            const { data, id: queryId } = update.callback_query;

            if (data === 'menu_stars') {
                await sendTG('editMessageText', {
                    chat_id: from.id,
                    message_id: update.callback_query.message.message_id,
                    text: texts.stars_plans,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `⭐ 100 — ${texts.plan_7d}`, callback_data: "buy_stars_7d" }],
                            [{ text: `⭐ 300 — ${texts.plan_1m}`, callback_data: "buy_stars_1m" }],
                            [{ text: `⭐ 2700 — ${texts.plan_1y}`, callback_data: "buy_stars_1y" }],
                            [{ text: "« Назад", callback_data: "menu_back" }]
                        ]
                    }
                });
            }

            if (data === 'menu_crypto') {
                await sendTG('editMessageText', {
                    chat_id: from.id,
                    message_id: update.callback_query.message.message_id,
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
            }

            if (data === 'menu_back') {
                await sendTG('editMessageText', {
                    chat_id: from.id,
                    message_id: update.callback_query.message.message_id,
                    text: texts.welcome_default,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: texts.stars_plans, callback_data: "menu_stars" }],
                            [{ text: texts.crypto_plans, callback_data: "menu_crypto" }],
                            [{ text: texts.get_promo, callback_data: "pay_trial" }]
                        ]
                    }
                });
            }

            if (data.startsWith('buy_stars_')) {
                const planId = data.replace('buy_stars_', '');
                const plan = PLANS[planId];
                const invoicePayload = `plan_${planId}_${from.id}_${Date.now()}`;

                await client.from('payments').insert({
                    user_id: from.id,
                    amount: plan.stars,
                    currency: 'stars',
                    status: 'pending',
                    provider_payment_charge_id: invoicePayload
                });

                await sendTG('sendInvoice', {
                    chat_id: from.id,
                    title: lang === 'ru' ? `Доступ на ${plan.label_ru}` : `${plan.label_en} Access`,
                    description: lang === 'ru' ? "Полный доступ к Threads AI" : "Full access to Threads AI",
                    payload: invoicePayload,
                    provider_token: "",
                    currency: "XTR",
                    prices: [{ label: "License", amount: plan.stars }]
                });
            }

            if (data.startsWith('buy_crypto_')) {
                const planId = data.replace('buy_crypto_', '');
                const plan = PLANS[planId];
                const externalId = `wpay_${planId}_${from.id}_${Date.now()}`;

                if (!WPAY_STORE_API_KEY) {
                    return await sendTG('answerCallbackQuery', { callback_query_id: queryId, text: "Wallet Pay is not configured on server.", show_alert: true });
                }

                // Create Wallet Pay Order
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

                if (wpayRes.status === 'SUCCESS') {
                    await client.from('payments').insert({
                        user_id: from.id,
                        amount: parseFloat(plan.crypto_val) * 100, // as cents usually
                        currency: 'usdt',
                        status: 'pending',
                        provider_payment_charge_id: externalId
                    });

                    await sendTG('sendMessage', {
                        chat_id: from.id,
                        text: lang === 'ru' ? "Оплатите заказ по ссылке:" : "Please pay via the link:",
                        reply_markup: {
                            inline_keyboard: [[{ text: "Open Wallet", url: wpayRes.data.payLink }]]
                        }
                    });
                } else {
                    console.error('Wallet Pay Order Error:', wpayRes);
                    await sendTG('answerCallbackQuery', { callback_query_id: queryId, text: "Order creation failed.", show_alert: true });
                }
            }

            if (data === 'pay_trial') {
                const { data: user } = await client.from('users').select('trial_used').eq('id', from.id).maybeSingle();
                if (user?.trial_used) return await sendTG('sendMessage', { chat_id: from.id, text: texts.promo_used });

                const trialKey = `TH-TRIAL-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                const expiresAt = new Date();
                expiresAt.setHours(expiresAt.getHours() + 24);

                const { error: licError } = await client.from('licenses').insert({
                    license_key: trialKey,
                    user_id: from.id,
                    expires_at: expiresAt.toISOString(),
                    status: 'active'
                });

                if (!licError) {
                    await client.from('users').update({ trial_used: true }).eq('id', from.id);
                    await sendTG('sendMessage', { chat_id: from.id, text: texts.success_trial.replace('${key}', trialKey), parse_mode: 'Markdown' });
                }
            }
        }

        // 3. Handle Pre-checkout
        if (update.pre_checkout_query) {
            await sendTG('answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: true });
        }

        // 4. Handle Successful Payment (Stars)
        if (update.message && update.message.successful_payment) {
            const sp = update.message.successful_payment;
            const payload = sp.invoice_payload;
            const planId = payload.split('_')[1];
            const plan = PLANS[planId] || PLANS["1y"];

            await client.from('payments').insert({
                user_id: from.id,
                amount: sp.total_amount,
                currency: 'stars',
                status: 'completed',
                provider_payment_charge_id: sp.invoice_payload,
                provider_payload: sp
            });

            const licenseKey = `TH-${planId.toUpperCase()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + plan.days);

            await client.from('licenses').insert({
                license_key: licenseKey,
                user_id: from.id,
                expires_at: expiresAt.toISOString(),
                status: 'active'
            });

            const durationText = lang === 'ru' ? plan.label_ru : plan.label_en;
            await sendTG('sendMessage', {
                chat_id: from.id,
                text: texts.success_payment.replace('${duration}', durationText).replace('${key}', licenseKey),
                parse_mode: 'Markdown'
            });
        }

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Bot Runtime Error:', error.message);
        res.status(200).json({ ok: false, error: error.message });
    }
};

async function sendTG(method, body) {
    if (!BOT_TOKEN) return { ok: false };
    return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).then(r => r.json());
}

const getSupabase = () => {
    if (!supabase) {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error('Supabase Env Vars missing');
        }
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    }
    return supabase;
};
let supabase;
