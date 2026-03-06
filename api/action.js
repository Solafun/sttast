const crypto = require('crypto');
const fetch = require('node-fetch');
const supabase = require('./_lib/supabase');
const { createStarsInvoice, notifySubscribers } = require('./_lib/bot');


// ============================================
// ВСТРОЕННАЯ ПРОВЕРКА TELEGRAM (БЕЗ ИМПОРТОВ)
// ============================================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_AUTH_AGE = 86400; // 24 часа

function verifyTelegramData(initData) {
    if (!initData) {
        console.warn('verifyTelegramData: initData is missing');
        return null;
    }

    try {
        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');
        urlParams.delete('hash');

        const authDate = parseInt(urlParams.get('auth_date'));
        if (!authDate || (Date.now() / 1000 - authDate) > MAX_AUTH_AGE) {
            console.warn('verifyTelegramData: Auth data expired');
            return null;
        }

        const dataCheckString = Array.from(urlParams.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        if (!BOT_TOKEN) {
            console.error('CRITICAL ERROR: TELEGRAM_BOT_TOKEN is not set in Environment Variables!');
            return null;
        }

        const secretKey = crypto.createHmac('sha256', 'WebAppData')
            .update(BOT_TOKEN)
            .digest();

        const calculatedHash = crypto.createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        if (calculatedHash !== hash) {
            console.warn('verifyTelegramData: Hash mismatch');
            return null;
        }

        const userStr = urlParams.get('user');
        return userStr ? JSON.parse(userStr) : null;

    } catch (error) {
        console.error('verifyTelegramData: Parsing error:', error);
        return null;
    }
}

// ============================================
// UTILITIES
// ============================================
function secureRandomInt(min, max) {
    return crypto.randomInt(min, max);
}

function generateVerificationCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'STARS-';
    for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(0, chars.length)];
    return code;
}

function getLocaleFromLanguage(langCode) {
    const map = {
        'ru': 'Russia / CIS', 'uk': 'Ukraine', 'be': 'Belarus',
        'kk': 'Kazakhstan', 'uz': 'Uzbekistan', 'en': 'English Speaking',
        'es': 'Spain / Latin America', 'pt': 'Portugal / Brazil',
        'fr': 'France / French Speaking', 'de': 'Germany / DACH',
        'it': 'Italy', 'tr': 'Turkey', 'ar': 'Arabic Speaking',
        'hi': 'India', 'zh': 'China', 'ja': 'Japan', 'ko': 'Korea',
    };
    return map[langCode] || 'Other';
}

// ============================================
// THREADS: Парсинг профиля
// ============================================
async function fetchFromThreads(username) {
    const url = `https://www.threads.com/@${username}`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const html = await response.text();
        if (!html || html.length < 100 || response.status === 404) return { exists: false, username, avatar: null };

        // --- Avatar extraction ---
        let avatar = null;
        let ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
        if (!ogMatch) ogMatch = html.match(/content="([^"]+)"\s+property="og:image"/);

        if (ogMatch) {
            const ogImage = ogMatch[1].replace(/&amp;/g, '&');

            // Filter out known placeholder/default avatar patterns:
            // 1. threads-logo images are obviously the brand logo
            // 2. default_avatar / blank profile pictures from Meta CDN
            // 3. 44884218_345707372676790 — this is Meta's universal default avatar asset ID
            const isPlaceholder = (
                ogImage.includes('threads-logo') ||
                ogImage.includes('default_avatar') ||
                ogImage.includes('44884218_345707372676790') ||
                ogImage.includes('instagram_silhouette') ||
                ogImage.includes('static.cdninstagram.com/rsrc') ||
                // Generic Meta CDN path with no user-specific hash (very short path)
                (/\/rsrc\.php\//.test(ogImage))
            );

            if (!isPlaceholder) avatar = ogImage;
        }

        // --- Profile existence confirmation ---
        // Non-existent profiles on Threads still return 200 with a generic page.
        // Real profiles have their username in og:title AND a real avatar.
        let profileConfirmed = false;
        const titleMatch = html.match(/property="og:title"\s+content="([^"]+)"/) ||
            html.match(/content="([^"]+)"\s+property="og:title"/);
        if (titleMatch) {
            const title = titleMatch[1].toLowerCase();
            // Real profile: title contains the username or their display name (not just generic Threads)
            profileConfirmed = title !== 'threads' && !title.includes('log in') && title.length > 3;
        }

        const exists = response.status === 200 && !!avatar && profileConfirmed;
        return { exists, username, avatar };
    } catch (error) {
        return { exists: false, username, avatar: null };
    }
}

// ============================================
// HANDLERS
// ============================================
// --- REUSABLE CORE LOGIC ---
async function getInternalUserData(user) {
    const languageCode = user.language_code || 'en';

    // Fetch app mode from settings
    const { data: settings } = await supabase
        .from('app_settings')
        .select('key, value');

    const getSetting = (key) => settings?.find(s => s.key === key)?.value;

    let appMode = 'active';
    if (getSetting('maintenance_enabled') === true) appMode = 'maintenance';
    else if (getSetting('verification_only_enabled') === true) appMode = 'verify_only';

    const { data: userData, error: userError } = await supabase
        .from('users')
        .upsert({
            id: user.id,
            username: user.username || null,
            first_name: user.first_name || 'User',
            last_name: user.last_name || null,
            language_code: languageCode,
            locale: getLocaleFromLanguage(languageCode),
            is_premium: user.is_premium || false,
            last_active_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' })
        .select()
        .single();

    if (userError) throw userError;

    // Blocked status overrides everything else
    if (userData.is_blocked === true) {
        appMode = 'blocked';
    }
    // If 'open_for_verified' is enabled, verified users get full access regardless of other modes
    else if (getSetting('open_for_verified') === true && userData.threads_verified === true) {
        appMode = 'active';
    }

    const { data: history } = await supabase
        .from('spins')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

    return {
        user: {
            id: userData.id,
            first_name: userData.first_name,
            last_name: userData.last_name,
            username: userData.username,
            balance: userData.balance,
            free_spins: userData.free_spins,
            total_spins: userData.total_spins,
            total_deposited: userData.total_deposited,
            threads_username: userData.threads_username || null,
            threads_verified: userData.threads_verified || false,
            threads_star_balance: userData.threads_star_balance || 0,
            verification_code: userData.verification_code || null,
            verification_status: userData.verification_status || 'none',
            is_blocked: userData.is_blocked || false,
            app_mode: appMode
        },
        history: history || []
    };
}

async function getInternalLeaderboard(limit = 50, offset = 0) {
    const { data, error } = await supabase.rpc('get_leaderboard', {
        p_limit: limit,
        p_offset: offset
    });

    if (error) throw error;
    return data.leaderboard || data;
}

// --- HANDLERS ---
async function handleInitApp(req, res, user) {
    try {
        const [userData, leaderboard] = await Promise.all([
            getInternalUserData(user),
            getInternalLeaderboard(50, 0)
        ]);

        return res.status(200).json({
            success: true,
            ...userData,
            leaderboard
        });
    } catch (error) {
        console.error('Init App Error:', error);
        return res.status(500).json({ success: false, error: 'Failed to initialize app data' });
    }
}

async function initUser(req, res, user) {
    try {
        const data = await getInternalUserData(user);
        return res.status(200).json({ success: true, ...data });
    } catch (error) {
        console.error('User upsert error:', error);
        return res.status(500).json({ success: false, error: 'Database error while saving user' });
    }
}

async function getLeaderboard(req, res) {
    try {
        const leaderboard = await getInternalLeaderboard(50, 0);
        return res.status(200).json({ success: true, leaderboard });
    } catch (error) {
        console.error('Leaderboard error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
    }
}

async function spinWheel(req, res, user) {
    try {
        const cost = req.body.cost ? parseInt(req.body.cost) : 1;
        console.log(`[SPIN] User ${user.id} attempting spin with cost ${cost}...`);

        let { data, error } = await supabase.rpc('process_spin_auto', {
            p_user_id: user.id,
            p_cost: cost
        });

        const { data: userCheck, error: checkError } = await supabase
            .from('users')
            .select('balance, threads_star_balance')
            .eq('id', user.id)
            .single();

        console.log(`[DIAGNOSTIC] User ${user.id} balance in DB:`, userCheck);

        // If auto spin (free) says we need payment, it means free spins are exhausted.
        if (data && !data.success && data.need_payment) {
            console.log(`[SPIN] No free spins (Count: ${data.free_spins_left}, Need Payment: ${data.need_payment}) for ${user.id}`);

            if (userCheck && (userCheck.balance > 0 || userCheck.threads_star_balance > 0)) {
                console.log(`[SPIN] User has balance (${userCheck.balance}), trying paid spin...`);
            } else {
                console.log(`[SPIN] User truly has no balance. Internal=${userCheck?.balance}`);
            }
            const { data: balanceData, error: balanceError } = await supabase.rpc('process_paid_spin_from_balance', {
                p_user_id: user.id,
                p_cost: cost
            });

            if (balanceError) {
                console.error(`[SPIN] RPC process_paid_spin_from_balance error:`, balanceError);
            }

            if (balanceData && balanceData.success) {
                console.log(`[SPIN] Paid spin from balance successful for ${user.id}`);
                // Notify subscribers for paid spin from balance
                if (balanceData.participant?.nickname) {
                    await notifySubscribers(supabase, balanceData.participant.nickname, user.id);
                }
                return res.status(200).json(balanceData);
            } else {
                const errorDetail = balanceData?.error || 'Internal error';
                console.log(`[SPIN] Internal balance spin failed for ${user.id}: ${errorDetail}`);
                // If it was specifically a balance issue, we return need_payment
                // but if it was something else (like "No participants"), we should show the error.
                if (errorDetail === 'Low balance' || errorDetail === 'No stars') {
                    return res.status(200).json(data);
                }
                return res.status(200).json({ success: false, error: errorDetail });
            }
        }

        if (error) {
            console.error('[SPIN] Auto spin RPC error:', error);
            return res.status(200).json({ success: false, error: 'Cannot spin right now (DB)' });
        }

        // Notify subscribers for free spin
        if (data && data.success && data.participant?.nickname) {
            await notifySubscribers(supabase, data.participant.nickname, user.id);
        }

        return res.status(200).json(data);
    } catch (err) {
        console.error('[SPIN] Unexpected error:', err);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
}

async function spinPaid(req, res, user) {
    const cost = req.body.cost ? parseInt(req.body.cost) : 1;

    const { count, error: countError } = await supabase
        .from('participants')
        .select('*', { count: 'exact', head: true });

    if (countError || !count || count === 0) {
        return res.status(200).json({ success: false, error: 'No participants available' });
    }

    const randomOffset = secureRandomInt(0, count);
    const { data: participants } = await supabase
        .from('participants')
        .select('id')
        .range(randomOffset, randomOffset)
        .limit(1);

    if (!participants || participants.length === 0) {
        return res.status(500).json({ success: false, error: 'Failed to select participant' });
    }

    // Shorten ID for payload limits (128 chars)
    const transactionId = `s${user.id}_${Date.now()}`;

    const { error: dbError } = await supabase.from('transactions').insert({
        id: transactionId, user_id: user.id, type: 'deposit', amount: cost, status: 'pending'
    });



    if (dbError) return res.status(500).json({ success: false, error: 'Database error' });

    try {
        const invoiceUrl = await createStarsInvoice(user.id, cost, {
            transaction_id: transactionId,
            type: 'paid_spin',
            participant_id: participants[0].id
        });
        return res.status(200).json({ success: true, invoiceUrl: invoiceUrl, transactionId: transactionId });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'Failed to create invoice' });
    }
}

async function createInvoice(req, res, user) {
    const { amount } = req.body;
    if (!amount || amount < 1 || amount > 10000) return res.status(400).json({ success: false, error: 'Invalid amount' });

    const transactionId = `d${user.id}_${Date.now()}`;

    await supabase.from('transactions').insert({
        id: transactionId, user_id: user.id, type: 'deposit', amount: amount, status: 'pending'
    });

    try {
        const invoiceUrl = await createStarsInvoice(user.id, amount, { transaction_id: transactionId, type: 'deposit' });

        return res.status(200).json({ success: true, invoiceUrl, transactionId });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'Failed to create invoice' });
    }
}

async function checkPayment(req, res, user) {
    const { transactionId } = req.body;
    const { data, error } = await supabase.rpc('check_transaction_status', { p_transaction_id: transactionId, p_user_id: user.id });
    if (error) return res.status(500).json({ success: false, error: 'Database error' });
    return res.status(200).json(data);
}

async function searchThreads(req, res, user) {
    const { nickname } = req.body;
    const clean = nickname.replace(/^@/, '').trim().toLowerCase();

    const { data: existing } = await supabase.from('participants').select('id, nickname, avatar_url, score').eq('nickname', clean).single();
    const threadResult = await fetchFromThreads(clean);

    if (existing) {
        if (threadResult.exists && threadResult.avatar && threadResult.avatar !== existing.avatar_url) {
            await supabase.from('participants').update({ avatar_url: threadResult.avatar }).eq('id', existing.id);
        }
        return res.status(200).json({ success: true, found: true, already_exists: true, nickname: clean, avatar_url: threadResult.avatar || existing.avatar_url, score: existing.score });
    }

    if (threadResult.exists) return res.status(200).json({ success: true, found: true, already_exists: false, nickname: clean, avatar_url: threadResult.avatar });
    return res.status(200).json({ success: true, found: false, nickname: clean });
}

async function addParticipant(req, res, user) {
    const { nickname } = req.body;
    const clean = nickname.replace(/^@/, '').trim().toLowerCase();

    // Check if already in the game
    const { data: existing } = await supabase.from('participants').select('id').eq('nickname', clean).single();
    if (existing) return res.status(200).json({ success: false, error: 'already_exists' });

    // Server-side verification: must be a real Threads profile with a real avatar
    const threadResult = await fetchFromThreads(clean);
    if (!threadResult.exists || !threadResult.avatar) {
        return res.status(200).json({ success: false, error: 'no_threads_profile' });
    }

    // Use the freshly fetched avatar (not client-provided, prevents spoofing)
    const { data, error } = await supabase
        .from('participants')
        .insert({ nickname: clean, avatar_url: threadResult.avatar, added_by: user.id })
        .select()
        .single();

    if (error) return res.status(500).json({ success: false, error: 'Database error' });

    return res.status(200).json({ success: true, participant: data });

}

async function toggleSubscription(req, res, user) {
    const { username } = req.body;
    const { data, error } = await supabase.rpc('toggle_subscription', { p_subscriber_id: user.id, p_target_username: username });
    if (error) return res.status(500).json({ success: false, error: 'Database error' });
    return res.status(200).json(data);
}

async function checkSubscription(req, res, user) {
    const { username } = req.body;
    const { data, error } = await supabase.rpc('check_subscription', { p_subscriber_id: user.id, p_target_username: username });
    if (error) return res.status(500).json({ success: false, error: 'Database error' });
    return res.status(200).json({ success: true, subscribed: data });
}

async function startVerification(req, res, user) {
    const { nickname } = req.body;
    if (!nickname) return res.status(400).json({ success: false, error: 'Nickname required' });
    const clean = nickname.replace(/^@/, '').trim().toLowerCase();

    // Check not already claimed by another user
    const { data: existingOwner } = await supabase
        .from('users')
        .select('id')
        .eq('threads_username', clean)
        .neq('id', user.id)
        .single();

    if (existingOwner) {
        return res.status(200).json({ success: false, error: 'already_claimed' });
    }

    // Check Threads profile exists
    const threadResult = await fetchFromThreads(clean);
    if (!threadResult.exists) {
        return res.status(200).json({ success: false, error: 'no_threads_profile' });
    }

    // Generate or reuse existing code
    const { data: existingUser } = await supabase
        .from('users')
        .select('verification_code, threads_username')
        .eq('id', user.id)
        .single();

    // Reuse code if same nickname, else generate new
    let code = existingUser?.verification_code;
    if (!code || existingUser?.threads_username !== clean) {
        code = generateVerificationCode();
    }

    await supabase.from('users').update({
        threads_username: clean,
        verification_code: code,
        verification_status: 'pending'
    }).eq('id', user.id);

    return res.status(200).json({ success: true, code, threads_username: clean });
}

async function checkVerification(req, res, user) {
    // Load user's pending verification data
    const { data: userData } = await supabase
        .from('users')
        .select('threads_username, verification_code, verification_status, threads_verified')
        .eq('id', user.id)
        .single();

    if (!userData?.threads_username || !userData?.verification_code) {
        return res.status(200).json({ success: false, error: 'no_pending_verification' });
    }

    if (userData.threads_verified) {
        return res.status(200).json({ success: true, verified: true, already: true });
    }

    // Fetch Threads profile page and look for the verification code
    const threadResult = await fetchFromThreads(userData.threads_username);
    let codeFound = false;

    if (threadResult.exists) {
        // Also try to fetch the raw HTML to search for the code in posts/bio
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(`https://www.threads.com/@${userData.threads_username}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const html = await response.text();
            codeFound = html.includes(userData.verification_code);
        } catch (e) {
            codeFound = false;
        }
    }

    if (!codeFound) {
        return res.status(200).json({ success: true, verified: false });
    }

    // Mark as verified
    await supabase.from('users').update({
        threads_verified: true,
        verification_status: 'verified'
    }).eq('id', user.id);

    // Link participant if one exists with this nickname or create new one
    const { data: existingParticipant } = await supabase.from('participants')
        .select('id')
        .eq('nickname', userData.threads_username)
        .single();

    if (existingParticipant) {
        await supabase.from('participants')
            .update({ owner_telegram_id: user.id })
            .eq('id', existingParticipant.id);
    } else if (threadResult.exists && threadResult.avatar) {
        await supabase.from('participants')
            .insert({
                nickname: userData.threads_username,
                avatar_url: threadResult.avatar,
                owner_telegram_id: user.id,
                added_by: user.id
            });
    }

    return res.status(200).json({ success: true, verified: true });
}

async function disconnectThreads(req, res, user) {
    const { error } = await supabase.from('users').update({
        threads_username: null,
        threads_verified: false,
        verification_code: null,
        verification_status: 'none'
    }).eq('id', user.id);

    if (error) {
        console.error('Disconnect Threads error:', error);
        return res.status(500).json({ success: false, error: 'Database error' });
    }

    return res.status(200).json({ success: true });
}

// ============================================
// MAIN HANDLER
// ============================================
module.exports = async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    try {
        const body = req.body || {};
        const action = body.action;

        if (!action) return res.status(400).json({ success: false, error: 'Action required' });

        // Лидерборд - публичный
        if (action === 'leaderboard') return await getLeaderboard(req, res);

        // Авторизация (используем встроенную функцию)
        const user = verifyTelegramData(body.initData);
        if (!user) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Telegram InitData' });
        }

        // Роутинг
        switch (action) {
            case 'init-app': return await handleInitApp(req, res, user);
            case 'init-user': return await initUser(req, res, user);
            case 'spin-wheel': return await spinWheel(req, res, user);
            case 'spin-paid': return await spinPaid(req, res, user);
            case 'create-invoice': return await createInvoice(req, res, user);
            case 'check-payment': return await checkPayment(req, res, user);
            case 'search-threads': return await searchThreads(req, res, user);
            case 'add-participant': return await addParticipant(req, res, user);
            case 'toggle-subscription': return await toggleSubscription(req, res, user);
            case 'check-subscription': return await checkSubscription(req, res, user);
            case 'start-verification': return await startVerification(req, res, user);
            case 'check-verification': return await checkVerification(req, res, user);
            case 'disconnect-threads': return await disconnectThreads(req, res, user);
            default:
                return res.status(400).json({ success: false, error: 'Unknown action' });
        }
    } catch (error) {
        console.error('MAIN HANDLER ERROR:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error', details: error.message });
    }
};