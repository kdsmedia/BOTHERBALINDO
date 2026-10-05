# ============================================
# 1. LOGIN KE CLOUDFLARE
# ============================================

npx wrangler login


# ============================================
# 2. MASUK KE FOLDER PROJECT
# ============================================

cd herbalindo-whatsapp-bot


# ============================================
# 3. SET WHATSAPP ACCESS TOKEN
# ============================================

npx wrangler secret put WHATSAPP_ACCESS_TOKEN


# ============================================
# 4. SET VERIFY TOKEN
# ============================================

npx wrangler secret put WHATSAPP_VERIFY_TOKEN


# ============================================
# 5. SET PHONE NUMBER ID
# ============================================

npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID





Tambahkan URL katalog WhatsApp
Karena menu PRODUK kita arahkan ke katalog WhatsApp, tambahkan variable berikut ke wrangler.toml:




name = "herbalindo-whatsapp-bot"
main = "src/index.js"
compatibility_date = "2026-10-05"

[[d1_databases]]
binding = "DB"
database_name = "herbalindo_db"
database_id = "GANTI_DENGAN_DATABASE_ID_ANDA"

[vars]
ADMIN_WHATSAPP = "6285813899649"

APP_DOWNLOAD_URL = "https://play.google.com/store/apps/details?id=com.altomedia.herbalindo"

WHATSAPP_CATALOG_URL = "GANTI_DENGAN_LINK_KATALOG_WHATSAPP"


Agar kode tetap rapi, kita tambahkan fungsi-fungsi berikut ke src/index.js.

/**
 * ============================================
 * LOGIN HARIAN
 * ============================================
 *
 * Reward:
 * Rp100 = 10.000 poin
 *
 * Member hanya mendapatkan reward
 * satu kali dalam satu hari.
 * ============================================
 */

async function processDailyLogin(member, env) {
  const today = getIndonesiaDate();

  /*
   * Jika member sudah login hari ini,
   * jangan berikan reward lagi.
   */
  if (member.daily_login_date === today) {
    return {
      success: false,
      alreadyClaimed: true,
      rewardAmount: 0,
      rewardPoints: 0,
      member
    };
  }

  const rewardAmount = 100;

  /*
   * Rp100
   * 1.000 poin = Rp10
   *
   * Rp100 = 10.000 poin
   */
  const rewardPoints = rewardAmount * 100;

  /*
   * Tambahkan poin dan tandai login hari ini.
   */
  await env.DB
    .prepare(`
      UPDATE members
      SET
        points = points + ?,
        daily_login_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE member_id = ?
    `)
    .bind(
      rewardPoints,
      today,
      member.member_id
    )
    .run();

  /*
   * Catat transaksi reward.
   */
  const transactionId =
    generateTransactionId("LOGIN");

  await env.DB
    .prepare(`
      INSERT INTO transactions (
        transaction_id,
        member_id,
        type,
        points,
        amount,
        description
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      transactionId,
      member.member_id,
      "daily_login",
      rewardPoints,
      rewardAmount,
      "Reward login harian"
    )
    .run();

  /*
   * Ambil data member terbaru.
   */
  const updatedMember =
    await getMemberByMemberId(
      env.DB,
      member.member_id
    );

  return {
    success: true,
    alreadyClaimed: false,
    rewardAmount,
    rewardPoints,
    member: updatedMember
  };
}


/**
 * ============================================
 * HALAMAN LOGIN HARIAN
 * ============================================
 */
async function dailyLoginPage(
  member,
  env
) {
  const result =
    await processDailyLogin(
      member,
      env
    );

  if (result.alreadyClaimed) {
    return `
---------------------------
       📅 LOGIN HARIAN
---------------------------

⚠️ Anda sudah melakukan
login harian hari ini.

🎁 Reward hari ini sudah
diberikan sebelumnya.

⭐ Poin:
${formatNumber(member.points)}

💵 Saldo:
${formatRupiah(
  calculateBalance(member.points)
)}

---------------------------
Coba lagi besok.

0  = Kembali
00 = Menu Utama
---------------------------
`.trim();
  }

  return `
---------------------------
       📅 LOGIN HARIAN
---------------------------

✅ LOGIN BERHASIL!

🎁 Reward:
Rp${formatNumber(
  result.rewardAmount
)}

⭐ +${formatNumber(
  result.rewardPoints
)} poin

━━━━━━━━━━━━━━━━━━

⭐ Total poin:
${formatNumber(
  result.member.points
)}

💵 Saldo:
${formatRupiah(
  calculateBalance(
    result.member.points
  )
)}

---------------------------
Reward login berikutnya
tersedia besok.

0  = Kembali
00 = Menu Utama
---------------------------
`.trim();
}


/**
 * ============================================
 * AMBIL MEMBER BERDASARKAN MEMBER ID
 * ============================================
 */
async function getMemberByMemberId(
  DB,
  memberId
) {
  return await DB
    .prepare(`
      SELECT *
      FROM members
      WHERE member_id = ?
      LIMIT 1
    `)
    .bind(memberId)
    .first();
}


/**
 * ============================================
 * TANGGAL INDONESIA
 * ============================================
 *
 * Menggunakan zona waktu Asia/Jakarta.
 *
 * Format:
 * YYYY-MM-DD
 * ============================================
 */
function getIndonesiaDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date());
}


/**
 * ============================================
 * GENERATE ID TRANSAKSI
 * ============================================
 */
function generateTransactionId(
  prefix = "TRX"
) {
  const timestamp =
    Date.now().toString(36)
      .toUpperCase();

  const random =
    Math.random()
      .toString(36)
      .substring(2, 7)
      .toUpperCase();

  return `${prefix}-${timestamp}-${random}`;
}
