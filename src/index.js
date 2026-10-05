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

    member = await createMember(
      env.DB,
      whatsapp,
      profileName
    );
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


/**
 * ============================================
 * HALAMAN SALDO
 * ============================================
 */
async function balancePage(member, env) {
  const saldo = calculateBalance(
    member.points
  );

  return `
---------------------------
        💰 SALDO SAYA
---------------------------

⭐ Poin  : ${formatNumber(member.points)}
💵 Saldo : ${formatRupiah(saldo)}

📌 Konversi:
1.000 poin = Rp10

---------------------------
        💸 TARIK SALDO
---------------------------

Ketik:

TARIK

untuk melakukan penarikan saldo.

---------------------------
0  = Kembali
00 = Menu Utama
---------------------------
`.trim();
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
