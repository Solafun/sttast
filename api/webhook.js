const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const { BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

// Lazy init supabase to prevent crash if env vars are missing during cold start
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
        crypto_info: "Для оплаты криптой, пожалуйста, переведите USDT (TRC-20) на адрес:\n`ВАШ_АДРЕС`\nПосле чего пришлите хеш транзакции.",
        success_payment: "✅ Оплата прошла успешно!\n\nТвой лицензионный ключ:\n`${key}`\n\nВставь его в настройки расширения.",
        welcome_default: "Привет! Я бот Threads AI. Выбери тариф ниже:"
    },
    en: {
        buy_stars: "Buy License (500 Stars) ⭐️",
        pay_crypto: "Pay with Crypto 💎",
        crypto_info: "To pay with crypto, please send USDT (TRC-20) to the address:\n`YOUR_ADDRESS`\nThen send the transaction hash here.",
        success_payment: "✅ Payment successful!\n\nYour license key:\n`${key}`\n\nPaste it into the extension settings.",
        welcome_default: "Hi! I am the Threads AI Bot. Choose your plan below:"
    }
};

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(200).send('Bot Status: Online');
    }

    const update = req.body;
    if (!update || !update.update_id) return res.status(200).end();

    const from = update.message?.from || update.callback_query?.from;
    const lang = (from?.language_code || 'en').startsWith('ru') ? 'ru' : 'en';
    const texts = UI[lang];

    try {
        const client = getSupabase();

        // 1. Handle /start
        if (update.message && update.message.text === '/start') {
            const { id, username, first_name, last_name } = from;
            const fullName = `${first_name || ''} ${last_name || ''}`.trim();

            // Sync User with language
            await client.from('users').upsert({
                id: id,
                username: username,
                full_name: fullName,
                language_code: lang
            });

            // Get Welcome Message from DB (fallback to UI dict)
            const { data: settings } = await client
                .from('bot_settings')
                .select('value')
                .eq('key', `welcome_message_${lang}`)
                .maybeSingle();

            const welcomeText = settings ? settings.value : texts.welcome_default;

            await sendTG('sendMessage', {
                chat_id: id,
                text: welcomeText,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: texts.buy_stars, callback_data: "pay_stars" }],
                        [{ text: texts.pay_crypto, callback_data: "pay_crypto" }]
                    ]
                }
            });
        }

        // 2. Handle Button Clicks
        if (update.callback_query) {
            const { data } = update.callback_query;

            if (data === 'pay_stars') {
                const { data: sTitle } = await client.from('bot_settings').select('value').eq('key', `invoice_title_${lang}`).maybeSingle();
                const { data: sDesc } = await client.from('bot_settings').select('value').eq('key', `invoice_desc_${lang}`).maybeSingle();

                await sendTG('sendInvoice', {
                    chat_id: from.id,
                    title: sTitle?.value || (lang === 'ru' ? "Лицензия Threads AI" : "Threads AI License"),
                    description: sDesc?.value || (lang === 'ru' ? "Доступ на 1 год" : "1 Year Access"),
                    payload: `license_${from.id}_${Date.now()}`,
                    provider_token: "",
                    currency: "XTR",
                    prices: [{ label: "License", amount: 500 }]
                });
            }

            if (data === 'pay_crypto') {
                await sendTG('sendMessage', {
                    chat_id: from.id,
                    text: texts.crypto_info,
                    parse_mode: 'Markdown'
                });
            }
        }

        // 3. Handle Pre-checkout
        if (update.pre_checkout_query) {
            await sendTG('answerPreCheckoutQuery', {
                pre_checkout_query_id: update.pre_checkout_query.id,
                ok: true
            });
        }

        // 4. Handle Successful Payment
        if (update.message && update.message.successful_payment) {
            const userId = from.id;

            // Log Payment
            await client.from('payments').insert({
                user_id: userId,
                amount: update.message.successful_payment.total_amount,
                currency: 'stars',
                status: 'completed',
                provider_payload: update.message.successful_payment
            });

            // Generate License Key
            const licenseKey = `TH-BY-${Math.random().toString(36).substring(2, 10).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            const expiresAt = new Date();
            expiresAt.setFullYear(expiresAt.getFullYear() + 1);

            await client.from('licenses').insert({
                license_key: licenseKey,
                user_id: userId,
                expires_at: expiresAt.toISOString(),
                status: 'active'
            });

            // Send Key to User (translated)
            const successMsg = texts.success_payment.replace('${key}', licenseKey);
            await sendTG('sendMessage', {
                chat_id: userId,
                text: successMsg,
                parse_mode: 'Markdown'
            });
        }

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Bot Error:', error.message);
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
