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

module.exports = async (req, res) => {
    console.log('--- Webhook Triggered ---');
    console.log('Method:', req.method);

    // 1. GET Request: Diagnostic Page
    if (req.method !== 'POST') {
        return res.status(200).send(`
            <html>
            <body style="font-family: sans-serif; padding: 20px;">
                <h1>Threads Bot Status</h1>
                <p>BOT_TOKEN: ${BOT_TOKEN ? '✅ Set' : '❌ MISSING'}</p>
                <p>SUPABASE_URL: ${SUPABASE_URL ? '✅ Set' : '❌ MISSING'}</p>
                <p>SUPABASE_KEY: ${SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ MISSING'}</p>
                <hr>
                <p><strong>Next Step:</strong> Send a message to your bot in Telegram.</p>
                <p>If variables are MISSING, add them in Vercel Project Settings -> Environment Variables.</p>
            </body>
            </html>
        `);
    }

    // 2. Incoming Update Handling
    const update = req.body;
    console.log('Update Received:', JSON.stringify(update, null, 2));

    if (!update || !update.update_id) {
        console.warn('Invalid update: missing update_id');
        return res.status(200).send('Invalid Telegram Update');
    }

    const message = update.message;

    try {
        const client = getSupabase();

        // 3. Handle /start
        if (message && message.text === '/start') {
            const { id, username, first_name, last_name } = message.from;
            const fullName = `${first_name || ''} ${last_name || ''}`.trim();

            console.log('Processing /start for:', id);

            // Sync User to Supabase
            await client.from('users').upsert({
                id: id,
                username: username,
                full_name: fullName
            });

            // Get Welcome Message
            const { data: settings } = await client
                .from('bot_settings')
                .select('value')
                .eq('key', 'welcome_message')
                .maybeSingle();

            const welcomeText = settings ? settings.value : "Hi! Ready to get your license?";

            // Send Buttons
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

        // 4. Handle Callback Queries (Button clicks)
        if (update.callback_query) {
            const { id, from, data } = update.callback_query;

            if (data === 'pay_stars') {
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

            console.log('Payment Successful:', userId, amount);

            // Log Payment
            await client.from('payments').insert({
                user_id: userId,
                amount: amount,
                currency: 'stars',
                status: 'completed',
                provider_payload: message.successful_payment
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

            // Send Key to User
            await sendTG('sendMessage', {
                chat_id: userId,
                text: `✅ Оплата прошла успешно!\n\nТвой лицензионный ключ:\n\`${licenseKey}\`\n\nВставь его в настройки расширения.`,
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
    if (!BOT_TOKEN) return { ok: false, error: 'No token' };
    return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).then(r => r.json());
}
