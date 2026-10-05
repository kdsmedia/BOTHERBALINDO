/**
 * ============================================
 * HERBALINDO WHATSAPP BOT
 * Cloudflare Workers + D1
 * ============================================
 *
 * Fitur tahap ini:
 * - Webhook WhatsApp
 * - Verifikasi webhook
 * - Registrasi member otomatis
 * - Menu utama
 * - PROFIL
 * - SALDO + POIN
 * - PRODUK -> Katalog WhatsApp
 * - DOWNLOAD APLIKASI
 * - LOGIN HARIAN
 * - Navigasi 0 dan 00
 *
 * ADMIN:
 * 085813899649
 * ============================================
 */

const APP_NAME = "HERBALINDO";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      /*
       * ========================================
       * WEBHOOK VERIFICATION
       * GET /webhook
       * ========================================
       */
      if (request.method === "GET" && url.pathname === "/webhook") {
        return verifyWebhook(url, env);
      }

      /*
       * ========================================
       * WHATSAPP WEBHOOK
       * POST /webhook
       * ========================================
       */
      if (request.method === "POST" && url.pathname === "/webhook") {
        return handleWebhook(request, env);
      }

      /*
       * ========================================
       * HEALTH CHECK
       * ========================================
       */
      if (request.method === "GET" && url.pathname === "/") {
        return jsonResponse({
          success: true,
          app: APP_NAME,
          status: "online"
        });
      }

      return new Response("Not Found", {
        status: 404
      });

    } catch (error) {
      console.error("Worker Error:", error);

      return jsonResponse(
        {
          success: false,
          error: "Internal Server Error"
        },
        500
      );
    }
  }
};


/**
 * ============================================
 * VERIFIKASI WEBHOOK META
 * ============================================
 */
function verifyWebhook(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    token === env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new Response(challenge, {
      status: 200
    });
  }

  return new Response("Forbidden", {
    status: 403
  });
}


/**
 * ============================================
 * HANDLE WEBHOOK
 * ============================================
 */
async function handleWebhook(request, env) {
  const body = await request.json();

  /*
   * Pastikan ini webhook WhatsApp Cloud API.
   */
  if (body.object !== "whatsapp_business_account") {
    return jsonResponse({
      success: true
    });
  }

  const entries = body.entry || [];

  for (const entry of entries) {
    const changes = entry.changes || [];

    for (const change of changes) {
      const value = change.value;

      if (!value || !value.messages) {
        continue;
      }

      const messages = value.messages;

      for (const message of messages) {
        await processMessage(message, value, env);
      }
    }
  }

  /*
   * WhatsApp mengharapkan response cepat.
   */
  return jsonResponse({
    success: true
  });
}


/**
 * ============================================
 * PROSES PESAN
 * ============================================
 */
async function processMessage(message, value, env) {
  if (!message || !message.from) {
    return;
  }

  /*
   * Untuk tahap awal kita fokus pada pesan text.
   */
  if (message.type !== "text") {
    return;
  }

  const whatsapp = normalizePhone(message.from);

  const text =
    message.text?.body?.trim() || "";

  if (!text) {
    return;
  }

  /*
   * ==========================================
   * CEK MEMBER
   * ==========================================
   */
  let member = await getMemberByWhatsApp(
    env.DB,
    whatsapp
  );

  /*
   * ==========================================
   * REGISTRASI OTOMATIS
   * ==========================================
   */
  if (!member) {

    const profileName =
      value.contacts?.[0]?.profile?.name ||
      "Member";

    /*
     * Cek apakah pesan berisi referral.
     *
     * Contoh:
     * DAFTAR 123456
     */
    const referralCode =
      parseReferralCode(text);

    /*
     * Pastikan ID referral memang milik
     * member yang sudah terdaftar.
     */
    let validReferral = null;

    if (referralCode) {
      validReferral = await env.DB
        .prepare(`
          SELECT member_id
          FROM members
          WHERE member_id = ?
          AND status = 'active'
          LIMIT 1
        `)
        .bind(referralCode)
        .first();
    }

    const newMemberId =
      await generateMemberId(env.DB);

    await env.DB
      .prepare(`
        INSERT INTO members (
          member_id,
          whatsapp,
          name,
          points,
          status,
          referred_by
        )
        VALUES (?, ?, ?, 0, 'active', ?)
      `)
      .bind(
        newMemberId,
        whatsapp,
        profileName,
        validReferral
          ? validReferral.member_id
          : null
      )
      .run();

    member =
      await getMemberByWhatsApp(
        env.DB,
        whatsapp
      );

    /*
     * Berikan reward kepada pengundang
     * setelah member berhasil dibuat.
     */
    if (validReferral) {
      await processReferralReward(
        env.DB,
        member
      );

      /*
       * Ambil data terbaru.
       */
      member =
        await getMemberByWhatsApp(
          env.DB,
          whatsapp
        );
    }
  }

  /*
   * ==========================================
   * CEK BLOKIR
   * ==========================================
   */
  if (member.status === "blocked") {
    await sendText(
      env,
      whatsapp,
      blockedMessage()
    );

    return;
  }

  /*
   * ==========================================
   * ADMIN
   * ==========================================
   */
  const admin =
    normalizePhone(env.ADMIN_WHATSAPP);

  if (
    whatsapp === admin &&
    isAdminCommand(text)
  ) {
    await handleAdminCommand(
      whatsapp,
      text,
      env
    );

    return;
  }

  /*
   * ==========================================
   * NAVIGASI
   * ==========================================
   */

  if (text === "00") {
    await sendText(
      env,
      whatsapp,
      mainMenu()
    );

    return;
  }

  if (text === "0") {
    /*
     * Untuk fondasi awal, kembali diarahkan
     * ke menu utama.
     *
     * Sistem riwayat halaman akan ditambahkan
     * pada tahap berikutnya.
     */
    await sendText(
      env,
      whatsapp,
      mainMenu()
    );

    return;
  }

  /*
   * ==========================================
   * MENU UTAMA
   * ==========================================
   */

  const command = normalizeCommand(text);

  switch (command) {

    case "PROFIL":
    case "1":
      await sendText(
        env,
        whatsapp,
        await profilePage(member, env)
      );
      break;

    case "SALDO":
    case "2":
      await sendText(
        env,
        whatsapp,
        await balancePage(member, env)
      );
      break;

    case "PRODUK":
    case "3":
      await sendCatalog(
        env,
        whatsapp
      );
      break;

    case "DOWNLOAD APLIKASI":
    case "DOWNLOAD":
    case "4":
      await sendText(
        env,
        whatsapp,
        downloadPage(env)
      );
      break;

    case "LOGIN HARIAN":
    case "LOGIN":
    case "5":
      await sendText(
        env,
        whatsapp,
        await dailyLoginPage(
          member,
          env
        )
      );
      break;

    case "UNDANG TEMAN":
    case "UNDANG":
    case "REFERRAL":
    case "REF":
    case "6":
      await sendText(
        env,
        whatsapp,
        referralPage(member, env)
      );
      break;

    case "MENU":
    case "MENU UTAMA":
    case "START":
    case "HALO":
    case "HAI":
      await sendText(
        env,
        whatsapp,
        mainMenu()
      );
      break;

    default:
      await sendText(
        env,
        whatsapp,
        unknownCommand()
      );
      break;
  }
}


/**
 * ============================================
 * MENU UTAMA
 * ============================================
 */
function mainMenu() {
  return `
---------------------------
       🤖 HERBALINDO
       MENU UTAMA
---------------------------

👤 PROFIL
💰 SALDO
🛍️ PRODUK
📅 LOGIN HARIAN
👥 UNDANG TEMAN
📲 DOWNLOAD APLIKASI

---------------------------
Ketik nama menu yang ingin
Anda pilih.

Contoh:
SALDO

---------------------------
0  = Kembali
00 = Menu Utama
---------------------------
`.trim();
}


/**
 * ============================================
 * PROFIL
 * ============================================
 */
async function profilePage(member, env) {
  const saldo = calculateBalance(
    member.points
  );

  return `
---------------------------
       👤 PROFIL MEMBER
---------------------------

Nama      : ${safeText(member.name)}
ID Member : ${safeText(member.member_id)}
WhatsApp  : ${formatPhone(member.whatsapp)}
Status    : ${member.status === "active"
    ? "AKTIF"
    : "DIBLOKIR"}

⭐ Poin    : ${formatNumber(member.points)}
💵 Saldo   : ${formatRupiah(saldo)}

---------------------------
0  = Kembali
00 = Menu Utama
---------------------------
`.trim();
}


// ============================================================
// BAB 7 — HALAMAN SALDO
// ============================================================

async function balancePage(member, env) {
  const balance = calculateBalance(member.points);

  return [
    "---------------------------",
    "       💰 SALDO SAYA",
    "---------------------------",
    "",
    `ID MEMBER : ${safeText(member.member_id)}`,
    `POIN      : ${formatNumber(member.points)}`,
    `SALDO     : ${formatRupiah(balance)}`,
    "",
    "KONVERSI OTOMATIS",
    "1.000 Poin = Rp10",
    "",
    "MENU:",
    "",
    "1. TARIK SALDO",
    "2. KEMBALI",
    "",
    "Ketik nomor menu.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 7 — NOMINAL PENARIKAN
// ============================================================

const WITHDRAWAL_AMOUNTS = [
  100,
  200,
  500,
  1000,
  2000,
  5000,
  10000,
  15000,
  20000
];

function withdrawalAmountPage() {
  return [
    "---------------------------",
    "       💸 TARIK SALDO",
    "---------------------------",
    "",
    "PILIH NOMINAL PENARIKAN:",
    "",
    "1. Rp100",
    "2. Rp200",
    "3. Rp500",
    "4. Rp1.000",
    "5. Rp2.000",
    "6. Rp5.000",
    "7. Rp10.000",
    "8. Rp15.000",
    "9. Rp20.000",
    "",
    "Ketik nomor pilihan.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 7 — METODE PENARIKAN
// ============================================================

function withdrawalMethodPage(amount) {
  return [
    "---------------------------",
    "    METODE PENARIKAN",
    "---------------------------",
    "",
    `Nominal : ${formatRupiah(amount)}`,
    "",
    "PILIH METODE:",
    "",
    "1. DANA",
    "2. OVO",
    "3. GOPAY",
    "",
    "Ketik nomor pilihan.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 7 — INPUT NOMOR AKUN
// ============================================================

function withdrawalAccountPage(method, amount) {
  return [
    "---------------------------",
    "    NOMOR AKUN TUJUAN",
    "---------------------------",
    "",
    `Metode  : ${method}`,
    `Nominal : ${formatRupiah(amount)}`,
    "",
    "Silakan kirim nomor akun",
    "DANA / OVO / GOPAY tujuan.",
    "",
    "Contoh:",
    "081234567890",
    "",
    "Pastikan nomor sudah benar.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 7 — NAMA PEMILIK AKUN
// ============================================================

function withdrawalAccountNamePage(method, amount, accountNumber) {
  return [
    "---------------------------",
    "     NAMA PEMILIK AKUN",
    "---------------------------",
    "",
    `Metode : ${method}`,
    `Nominal: ${formatRupiah(amount)}`,
    `Akun   : ${safeText(accountNumber)}`,
    "",
    "Kirim NAMA PEMILIK akun.",
    "",
    "Contoh:",
    "BUDI SANTOSO",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 7 — KONFIRMASI PENARIKAN
// ============================================================

function withdrawalConfirmationPage(member, data) {
  const balanceBefore = calculateBalance(member.points);

  return [
    "---------------------------",
    "   KONFIRMASI PENARIKAN",
    "---------------------------",
    "",
    `ID TRANSAKSI : ${safeText(data.withdrawalId)}`,
    `ID MEMBER    : ${safeText(member.member_id)}`,
    `WHATSAPP     : ${safeText(formatPhone(member.whatsapp))}`,
    "",
    `NOMINAL      : ${formatRupiah(data.amount)}`,
    `METODE       : ${safeText(data.method)}`,
    `NOMOR AKUN   : ${safeText(data.accountNumber)}`,
    `NAMA PEMILIK : ${safeText(data.accountName)}`,
    "",
    `SALDO SEBELUM: ${formatRupiah(balanceBefore)}`,
    "",
    "Apakah data sudah benar?",
    "",
    "1. YA, AJUKAN PENARIKAN",
    "2. BATAL",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


/**
 * ============================================
 * DOWNLOAD APLIKASI
 * ============================================
 */
function downloadPage(env) {
  return `
---------------------------
    📲 DOWNLOAD APLIKASI
---------------------------

Aplikasi resmi HERBALINDO
tersedia di Google Play Store.

👇 Download aplikasi:

${env.APP_DOWNLOAD_URL}

---------------------------
0  = Kembali
00 = Menu Utama
---------------------------
`.trim();
}


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


/**
 * ============================================
 * PESAN MEMBER DIBLOKIR
 * ============================================
 */
function blockedMessage() {
  return `
---------------------------
       🚫 AKSES DIBLOKIR
---------------------------

Akun WhatsApp Anda saat ini
telah diblokir oleh admin.

Silakan hubungi admin untuk
informasi lebih lanjut.

---------------------------
`.trim();
}


/**
 * ============================================
 * PESAN PERINTAH TIDAK DIKENALI
 * ============================================
 */
function unknownCommand() {
  return `
---------------------------
      ⚠️ PERINTAH SALAH
---------------------------

Perintah tidak dikenali.

Silakan ketik:

MENU

untuk menampilkan menu utama.

---------------------------
0  = Kembali
00 = Menu Utama
---------------------------
`.trim();
}


/**
 * ============================================
 * DATABASE - CARI MEMBER
 * ============================================
 */
async function getMemberByWhatsApp(DB, whatsapp) {
  return await DB
    .prepare(`
      SELECT *
      FROM members
      WHERE whatsapp = ?
      LIMIT 1
    `)
    .bind(whatsapp)
    .first();
}


/**
 * ============================================
 * DATABASE - BUAT MEMBER
 * ============================================
 */
async function createMember(
  DB,
  whatsapp,
  name
) {
  const memberId =
    await generateMemberId(DB);

  await DB
    .prepare(`
      INSERT INTO members (
        member_id,
        whatsapp,
        name,
        points,
        status
      )
      VALUES (?, ?, ?, 0, 'active')
    `)
    .bind(
      memberId,
      whatsapp,
      name || "Member"
    )
    .run();

  return await getMemberByWhatsApp(
    DB,
    whatsapp
  );
}


/**
 * ============================================
 * GENERATE ID MEMBER 6 DIGIT
 * ============================================
 */
async function generateMemberId(DB) {
  for (let attempt = 0; attempt < 20; attempt++) {

    const number =
      Math.floor(
        100000 +
        Math.random() * 900000
      ).toString();

    const exists = await DB
      .prepare(`
        SELECT member_id
        FROM members
        WHERE member_id = ?
        LIMIT 1
      `)
      .bind(number)
      .first();

    if (!exists) {
      return number;
    }
  }

  throw new Error(
    "Gagal membuat ID member unik."
  );
}


/**
 * ============================================
 * HITUNG SALDO DARI POIN
 * ============================================
 *
 * 1.000 poin = Rp10
 *
 * Saldo hanya dihitung dari poin.
 */
function calculateBalance(points) {
  return Math.floor(
    Number(points || 0) / 100
  );
}


/**
 * ============================================
 * KIRIM PESAN TEXT KE WHATSAPP
 * ============================================
 */
async function sendText(
  env,
  recipient,
  message
) {
  const url =
    `https://graph.facebook.com/v23.0/` +
    `${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response =
    await fetch(url, {
      method: "POST",
      headers: {
        "Authorization":
          `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: {
          preview_url: true,
          body: message
        }
      })
    });

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      "WhatsApp API Error:",
      errorText
    );
  }
}


/**
 * ============================================
 * KATALOG WHATSAPP
 * ============================================
 *
 * URL katalog diambil dari variable:
 * WHATSAPP_CATALOG_URL
 */
async function sendCatalog(
  env,
  recipient
) {
  const catalogUrl =
    env.WHATSAPP_CATALOG_URL;

  if (!catalogUrl) {
    await sendText(
      env,
      recipient,
      `
---------------------------
        🛍️ PRODUK
---------------------------

Katalog WhatsApp belum
dikonfigurasi.

Silakan hubungi admin.

---------------------------
0  = Kembali
00 = Menu Utama
---------------------------
`.trim()
    );

    return;
  }

  await sendText(
    env,
    recipient,
    `
---------------------------
        🛍️ PRODUK
---------------------------

Silakan lihat seluruh
produk kami melalui
Katalog WhatsApp.

🛒 LIHAT KATALOG:

${catalogUrl}

---------------------------
0  = Kembali
00 = Menu Utama
---------------------------
`.trim()
  );
}


/**
 * ============================================
 * ADMIN COMMAND
 * ============================================
 */
function isAdminCommand(text) {
  const command =
    normalizeCommand(text);

  return [
    "ADMIN",
    "ADMIN PANEL",
    "MEMBER",
    "SALDO ADMIN",
    "WITHDRAW ADMIN"
  ].includes(command);
}


/**
 * ============================================
 * ADMIN PANEL DASAR
 * ============================================
 *
 * Fitur pengelolaan admin akan ditambahkan
 * pada BAB berikutnya.
 */
async function handleAdminCommand(
  whatsapp,
  text,
  env
) {
  await sendText(
    env,
    whatsapp,
    `
---------------------------
       🔐 ADMIN PANEL
---------------------------

1. 👥 KELOLA MEMBER
2. 💰 KELOLA SALDO
3. 💸 PERMINTAAN WITHDRAW

---------------------------
0  = Kembali
00 = Menu Utama
---------------------------
`.trim()
  );
}


/**
 * ============================================
 * NORMALISASI PERINTAH
 * ============================================
 */
function normalizeCommand(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}


/**
 * ============================================
 * NORMALISASI NOMOR
 * ============================================
 *
 * WhatsApp Cloud API biasanya mengirim
 * nomor dalam format internasional.
 */
function normalizePhone(phone) {
  let value =
    String(phone || "")
      .replace(/\D/g, "");

  if (value.startsWith("0")) {
    value =
      "62" + value.substring(1);
  }

  return value;
}


/**
 * ============================================
 * FORMAT NOMOR
 * ============================================
 */
function formatPhone(phone) {
  const value =
    normalizePhone(phone);

  if (value.startsWith("62")) {
    return "0" + value.substring(2);
  }

  return value;
}


/**
 * ============================================
 * FORMAT ANGKA
 * ============================================
 */
function formatNumber(value) {
  return Number(value || 0)
    .toLocaleString("id-ID");
}


/**
 * ============================================
 * FORMAT RUPIAH
 * ============================================
 */
function formatRupiah(value) {
  return "Rp" +
    Number(value || 0)
      .toLocaleString("id-ID");
}


/**
 * ============================================
 * AMANKAN TEXT UNTUK OUTPUT
 * ============================================
 */
function safeText(value) {
  return String(value || "")
    .replace(/[\r\n]/g, " ")
    .substring(0, 100);
}


/**
 * ============================================
 * JSON RESPONSE
 * ============================================
 */
function jsonResponse(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );
}


/**
 * ============================================
 * REFERRAL
 * ============================================
 *
 * Reward pengundang:
 * Rp1.000 = 100.000 poin
 *
 * Reward hanya diberikan satu kali untuk
 * setiap member baru yang berhasil terdaftar.
 * ============================================
 */
async function processReferralReward(
  DB,
  newMember
) {
  if (!newMember.referred_by) {
    return;
  }

  /*
   * Jangan memberikan reward dua kali.
   */
  if (Number(newMember.referral_rewarded) === 1) {
    return;
  }

  /*
   * Cari member yang mengundang.
   */
  const inviter = await DB
    .prepare(`
      SELECT *
      FROM members
      WHERE member_id = ?
      LIMIT 1
    `)
    .bind(newMember.referred_by)
    .first();

  /*
   * Jika ID referral tidak ditemukan,
   * tidak ada reward.
   */
  if (!inviter) {
    return;
  }

  /*
   * Jangan memberi reward kepada akun yang
   * mengundang dirinya sendiri.
   */
  if (
    inviter.member_id === newMember.member_id
  ) {
    return;
  }

  const rewardAmount = 1000;
  const rewardPoints = 100000;

  /*
   * Tambahkan poin kepada pengundang.
   */
  await DB
    .prepare(`
      UPDATE members
      SET
        points = points + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE member_id = ?
    `)
    .bind(
      rewardPoints,
      inviter.member_id
    )
    .run();

  /*
   * Tandai bahwa member baru sudah
   * menghasilkan reward referral.
   */
  await DB
    .prepare(`
      UPDATE members
      SET
        referral_rewarded = 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE member_id = ?
    `)
    .bind(
      newMember.member_id
    )
    .run();

  /*
   * Catat transaksi referral.
   */
  const transactionId =
    generateTransactionId("REF");

  await DB
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
      inviter.member_id,
      "referral",
      rewardPoints,
      rewardAmount,
      `Reward mengundang member ${newMember.member_id}`
    )
    .run();
}


/**
 * ============================================
 * HALAMAN UNDANG TEMAN
 * ============================================
 */
function referralPage(
  member,
  env
) {
  const referralId =
    member.member_id;

  const botNumber =
    normalizePhone(
      env.WHATSAPP_BOT_NUMBER || ""
    );

  const referralText =
    encodeURIComponent(
      `DAFTAR ${referralId}`
    );

  let referralLink = "";

  if (botNumber) {
    referralLink =
      `https://wa.me/${botNumber}?text=${referralText}`;
  } else {
    referralLink =
      `Kirim pesan "DAFTAR ${referralId}" ke nomor bot HERBALINDO.`;
  }

  return `
---------------------------
       👥 UNDANG TEMAN
---------------------------

🎁 Reward undang teman:

💵 Rp1.000
⭐ 100.000 poin

━━━━━━━━━━━━━━━━━━

🆔 ID Referral Anda:

${referralId}

━━━━━━━━━━━━━━━━━━

🔗 LINK UNDANGAN:

${referralLink}

━━━━━━━━━━━━━━━━━━

Teman Anda harus mendaftar
melalui link/kode referral
tersebut.

---------------------------
0  = Kembali
00 = Menu Utama
---------------------------
`.trim();
}


/**
 * ============================================
 * PARSE KODE REFERRAL
 * ============================================
 *
 * Contoh:
 *
 * DAFTAR 123456
 * REF 123456
 * REFERRAL 123456
 * ============================================
 */
function parseReferralCode(text) {
  const value =
    String(text || "")
      .trim()
      .toUpperCase();

  const match =
    value.match(
      /^(?:DAFTAR|REF|REFERRAL)\s+(\d{6})$/
    );

  if (!match) {
    return null;
  }

  return match[1];
}


// ============================================================
// BAB 7 — USER SESSION
// ============================================================

async function getSession(DB, whatsapp) {
  const result = await DB.prepare(`
    SELECT whatsapp, state, session_data
    FROM user_sessions
    WHERE whatsapp = ?
  `).bind(whatsapp).first();

  if (!result) {
    return {
      whatsapp,
      state: "main",
      data: {}
    };
  }

  let data = {};

  try {
    data = JSON.parse(result.session_data || "{}");
  } catch {
    data = {};
  }

  return {
    whatsapp: result.whatsapp,
    state: result.state,
    data
  };
}

async function setSession(DB, whatsapp, state, data = {}) {
  await DB.prepare(`
    INSERT INTO user_sessions (
      whatsapp,
      state,
      session_data,
      updated_at
    )
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(whatsapp)
    DO UPDATE SET
      state = excluded.state,
      session_data = excluded.session_data,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    whatsapp,
    state,
    JSON.stringify(data)
  ).run();
}

async function clearSession(DB, whatsapp) {
  await DB.prepare(`
    INSERT INTO user_sessions (
      whatsapp,
      state,
      session_data,
      updated_at
    )
    VALUES (?, 'main', '{}', CURRENT_TIMESTAMP)
    ON CONFLICT(whatsapp)
    DO UPDATE SET
      state = 'main',
      session_data = '{}',
      updated_at = CURRENT_TIMESTAMP
  `).bind(whatsapp).run();
}
