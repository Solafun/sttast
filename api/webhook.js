const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const { BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

// Lazy init supabase
let supabase;
const getSupabase = () => {
    if (!supabase) {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error('Supabase Env Vars missing');
        }
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    }
    return supabase;
};

// UI Text Dictionary
const UI = {
    ru: {
        buy_stars: "Купить лицензию (500 Stars) ⭐️",
        pay_crypto: "Оплата Криптой 💎",
        get_promo: "🎁 Получить Промо (24ч)",
        promo_used: "❌ Вы уже использовали промо-период.",
        crypto_info: "Для оплаты криптой, пожалуйста, переведите USDT (TRC-20) на адрес:\n`ВАШ_АДРЕС`\nПосле чего пришлите хеш транзакции.",
        success_payment: "✅ Оплата прошла успешно!\n\nТвой лицензионный ключ:\n`${key}`\n\nВставь его в настройки расширения.",
        success_trial: "🎁 Тебе выдан пробный ключ на 24 часа!\n\nКлюч:\n`${key}`\n\nПоспеши использовать!",
        welcome_default: "Привет! Я бот Threads AI. Выбери тариф ниже:"
    },
    en: {
        buy_stars: "Buy License (500 Stars) ⭐️",
        pay_crypto: "Pay with Crypto 💎",
        get_promo: "🎁 Get Promo (24h)",
        promo_used: "❌ You have already used your promo period.",
        crypto_info: "To pay with crypto, please send USDT (TRC-20) to the address:\n`YOUR_ADDRESS`\nThen send the transaction hash here.",
        success_payment: "✅ Payment successful!\n\nYour license key:\n`${key}`\n\nPaste it into the extension settings.",
        success_trial: "🎁 You received a 24h trial key!\n\nKey:\n`${key}`\n\nUse it now!",
        welcome_default: "Hi! I am the Threads AI Bot. Choose your plan below:"
    }
};

module.exports = async (req, res) => {
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

            const { error: upsertError } = await client.from('users').upsert({
                id: id,
                username: username,
                full_name: fullName,
                language_code: lang
            });

            if (upsertError) console.error('Supabase Upsert Error:', upsertError);

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
                        [{ text: texts.buy_stars, callback_data: "pay_stars" }],
                        [{ text: texts.pay_crypto, callback_data: "pay_crypto" }],
                        [{ text: texts.get_promo, callback_data: "pay_trial" }]
                    ]
                }
            });
        }

        // 2. Handle Button Clicks
        if (update.callback_query) {
            const { data } = update.callback_query;

            if (data === 'pay_stars') {
                const invoicePayload = `license_${from.id}_${Date.now()}`;
                await client.from('payments').insert({
                    user_id: from.id,
                    amount: 500,
                    currency: 'stars',
                    status: 'pending',
                    provider_payment_charge_id: invoicePayload
                });

                await sendTG('sendInvoice', {
                    chat_id: from.id,
                    title: lang === 'ru' ? "Лицензия Threads AI" : "Threads AI License",
                    description: lang === 'ru' ? "Доступ на 1 год" : "1 Year Access",
                    payload: invoicePayload,
                    provider_token: "",
                    currency: "XTR",
                    prices: [{ label: "License", amount: 500 }]
                });
            }

            if (data === 'pay_trial') {
                // Check if user already used trial
                const { data: user, error: userError } = await client
                    .from('users')
                    .select('trial_used')
                    .eq('id', from.id)
                    .maybeSingle();

                if (user?.trial_used) {
                    return await sendTG('sendMessage', { chat_id: from.id, text: texts.promo_used });
                }

                // Issue 24h key
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
                    await sendTG('sendMessage', {
                        chat_id: from.id,
                        text: texts.success_trial.replace('${key}', trialKey),
                        parse_mode: 'Markdown'
                    });
                } else {
                    console.error('Trial Issuance Error:', licError);
                }
            }

            if (data === 'pay_crypto') {
                await sendTG('sendMessage', { chat_id: from.id, text: texts.crypto_info, parse_mode: 'Markdown' });
            }
        }

        // 3. Handle Pre-checkout
        if (update.pre_checkout_query) {
            await sendTG('answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: true });
        }

        // 4. Handle Successful Payment
        if (update.message && update.message.successful_payment) {
            const sp = update.message.successful_payment;
            await client.from('payments').insert({
                user_id: from.id,
                amount: sp.total_amount,
                currency: 'stars',
                status: 'completed',
                provider_payment_charge_id: sp.invoice_payload,
                provider_payload: sp
            });

            const licenseKey = `TH-BY-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
            const expiresAt = new Date();
            expiresAt.setFullYear(expiresAt.getFullYear() + 1);

            await client.from('licenses').insert({
                license_key: licenseKey,
                user_id: from.id,
                expires_at: expiresAt.toISOString(),
                status: 'active'
            });

            await sendTG('sendMessage', {
                chat_id: from.id,
                text: texts.success_payment.replace('${key}', licenseKey),
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
