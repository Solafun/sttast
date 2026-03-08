const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// Environment Variables required on Vercel:
// BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
const { BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
    console.log('--- Webhook Triggered ---');
    console.log('Method:', req.method);

    // Check Env Vars
    if (!BOT_TOKEN) console.error('CRITICAL: BOT_TOKEN is missing!');
    if (!SUPABASE_URL) console.error('CRITICAL: SUPABASE_URL is missing!');

    if (req.method !== 'POST') {
        return res.status(200).send('Bot is active. Use POST for Telegram updates.');
    }

    const update = req.body;
    console.log('Update Received:', JSON.stringify(update, null, 2));

    if (!update || !update.update_id) {
        console.warn('Invalid update received (no update_id)');
        return res.status(200).send('Invalid update');
    }

    const message = update.message;

    try {
        if (message && message.text === '/start') {
            const { id, username, first_name, last_name } = message.from;
            const fullName = `${first_name || ''} ${last_name || ''}`.trim();

            // 1. Sync User to Supabase
            await supabase.from('users').upsert({
                id: id,
                username: username,
                full_name: fullName
            });

            // 2. Get Welcome Message from settings
            const { data: settings } = await supabase
                .from('bot_settings')
                .select('value')
                .eq('key', 'welcome_message')
                .single();

            const welcomeText = settings ? settings.value : "Hi! Ready to get your license?";

            // 3. Send Response with Payment Buttons
            await sendTG('sendMessage', {
                chat_id: id,
                text: welcomeText,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Купить лицензию (500 Stars) ⭐️", callback_data: "pay_stars" }],
                        [{ text: "Оплата Криптой 💎", callback_data: "pay_crypto" }]
                    ]
                }
            });
        }

        // 4. Handle Callback Queries (Payment clicks)
        if (update.callback_query) {
            const { id, from, data } = update.callback_query;

            if (data === 'pay_stars') {
                // Create an Invoice for Stars
                await sendTG('sendInvoice', {
                    chat_id: from.id,
                    title: "Threads AI License",
                    description: "Full access for 1 year",
                    payload: `license_${from.id}_${Date.now()}`,
                    provider_token: "", // Empty for Stars
                    currency: "XTR",
                    prices: [{ label: "1 Year License", amount: 500 }]
                });
            }

            if (data === 'pay_crypto') {
                await sendTG('sendMessage', {
                    chat_id: from.id,
                    text: "Для оплаты криптой, пожалуйста, переведите USDT (TRC-20) на адрес:\n`ВАШ_АДРЕС`\nПосле чего пришлите хеш транзакции."
                });
            }
        }

        // 5. Handle Successful Payment
        if (message && message.successful_payment) {
            const userId = message.from.id;
            const amount = message.successful_payment.total_amount;

            // 1. Log Payment
            await supabase.from('payments').insert({
                user_id: userId,
                amount: amount,
                currency: 'stars',
                status: 'completed',
                provider_payload: message.successful_payment
            });

            // 2. Generate License Key
            const licenseKey = `TH-BY-${Math.random().toString(36).substring(2, 10).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            const expiresAt = new Date();
            expiresAt.setFullYear(expiresAt.getFullYear() + 1);

            await supabase.from('licenses').insert({
                license_key: licenseKey,
                user_id: userId,
                expires_at: expiresAt.toISOString(),
                status: 'active'
            });

            // 3. Send Key to User
            await sendTG('sendMessage', {
                chat_id: userId,
                text: `✅ Оплата прошла успешно!\n\nТвой лицензионный ключ:\n\`${licenseKey}\`\n\nВставь его в настройки расширения.`,
                parse_mode: 'Markdown'
            });
        }

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Bot Error:', error);
        res.status(200).json({ ok: false, error: error.message });
    }
};

async function sendTG(method, body) {
    return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).then(r => r.json());
}
