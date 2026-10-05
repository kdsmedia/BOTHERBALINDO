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
        const reply = await processMessage(message, value, env);

        if (typeof reply === "string") {
          await sendText(env, normalizePhone(message.from), reply);
        }
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

  // ============================================
  // BAB 12 — INTEGRASI REFERRAL
  // ============================================

  // Cek apakah pesan berisi kode referral.
  // Contoh: DAFTAR 123456

  const referralId =
    parseReferralCommand(text);

  // ============================================
  // BAB 12
  // HANDLER NAMA PENDAFTARAN
  // ============================================

  const currentSession =
    await getSession(
      env.DB,
      whatsapp
    );

  // --------------------------------------------
  // PROSES NAMA MEMBER BARU
  // --------------------------------------------

  if (
    currentSession &&
    currentSession.state === "register_name"
  ) {
    const sessionData =
      currentSession.data || {};

    const name =
      String(text || "").trim();

    // ----------------------------------------
    // VALIDASI NAMA
    // ----------------------------------------

    if (!name) {
      return `
---------------------------
       ⚠️ NAMA
---------------------------

Nama tidak boleh kosong.

Silakan masukkan nama lengkap
Anda.

---------------------------
`;
    }

    if (name.length < 2) {
      return `
---------------------------
       ⚠️ NAMA
---------------------------

Nama terlalu pendek.

Silakan masukkan nama yang
benar.

---------------------------
`;
    }

    if (name.length > 100) {
      return `
---------------------------
       ⚠️ NAMA
---------------------------

Nama terlalu panjang.

Maksimal 100 karakter.

---------------------------
`;
    }

    // ----------------------------------------
    // CEK REFERRAL
    // ----------------------------------------

    const referralId =
      sessionData.referral_id || null;

    // ----------------------------------------
    // DAFTARKAN MEMBER
    // ----------------------------------------

    const result =
      await registerMember(
        env.DB,
        whatsapp,
        name,
        referralId
      );

    // ----------------------------------------
    // BERSIHKAN SESSION
    // ----------------------------------------

    await clearSession(
      env.DB,
      whatsapp
    );

    // ----------------------------------------
    // HASIL
    // ----------------------------------------

    if (!result.success) {
      if (
        result.reason ===
        "already_registered"
      ) {
        return alreadyRegisteredPage(
          result.member
        );
      }

      if (
        result.reason ===
        "invalid_referral"
      ) {
        return invalidReferralPage();
      }

      if (
        result.reason ===
        "self_referral"
      ) {
        return selfReferralPage();
      }

      if (
        result.reason ===
        "inviter_blocked"
      ) {
        return blockedInviterPage();
      }

      return `
---------------------------
       ❌ PENDAFTARAN
---------------------------

Pendaftaran gagal.

Silakan coba kembali.

---------------------------
`;
    }

    // ----------------------------------------
    // PENDAFTARAN BERHASIL
    // ----------------------------------------

    return registrationSuccessPage(
      result
    );
  }

  // ------------------------------------------------------------
  // TERIMA KODE REFERRAL → MINTA NAMA
  // ------------------------------------------------------------

  if (referralId && !member) {
    const existingMember =
      await getMemberByWhatsApp(
        env.DB,
        whatsapp
      );

    if (existingMember) {
      return alreadyRegisteredPage(
        existingMember
      );
    }

    await setSession(
      env.DB,
      whatsapp,
      "register_name",
      {
        referral_id: referralId
      }
    );

    return [
      "---------------------------",
      "     🌿 PENDAFTARAN",
      "---------------------------",
      "",
      "ID Referral:",
      `${referralId}`,
      "",
      "Silakan masukkan",
      "nama lengkap Anda.",
      "",
      "Contoh:",
      "",
      "Budi Santoso",
      "",
      "---------------------------",
      "",
      "0. Kembali",
      "00. Menu Utama",
      "---------------------------"
    ].join("\n");
  }

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
      parseReferralCommand(text);

    const registration =
      await registerMember(
        env.DB,
        whatsapp,
        profileName,
        referralCode
      );

    if (!registration.success) {
      if (
        registration.reason ===
        "already_registered"
      ) {
        await sendText(
          env,
          whatsapp,
          alreadyRegisteredPage(
            registration.member
          )
        );

        return;
      }

      if (
        registration.reason ===
        "invalid_referral"
      ) {
        await sendText(
          env,
          whatsapp,
          invalidReferralPage()
        );

        return;
      }

      if (
        registration.reason ===
        "self_referral"
      ) {
        await sendText(
          env,
          whatsapp,
          selfReferralPage()
        );

        return;
      }

      if (
        registration.reason ===
        "inviter_blocked"
      ) {
        await sendText(
          env,
          whatsapp,
          blockedInviterPage()
        );

        return;
      }

      return;
    }

    member = registration.member;

    await sendText(
      env,
      whatsapp,
      registrationSuccessPage(
        registration
      )
    );

    return;
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
  const adminResponse =
    await handleAdminCommand(
      env.DB,
      member,
      text,
      env
    );

  if (adminResponse) {
    return adminResponse;
  }

  /*
   * ==========================================
   * MENU UTAMA
   * ==========================================
   */

  const command = normalizeCommand(text);

  // ------------------------------------------------------------
  // 0 = Kembali
  // ------------------------------------------------------------
  //
  // Harus diproses SEBELUM blok session withdrawal agar
  // pengguna dapat keluar dari proses penarikan kapan saja.

  if (command === "0") {
    await clearSession(env.DB, member.whatsapp);

    return mainMenu();
  }

  // ------------------------------------------------------------
  // 00 = Menu Utama
  // ------------------------------------------------------------

  if (command === "00") {
    await clearSession(env.DB, member.whatsapp);

    return mainMenu();
  }

  // ------------------------------------------------------------
  // PROSES SESSION WITHDRAWAL
  // ------------------------------------------------------------

  const session = await getSession(
    env.DB,
    member.whatsapp
  );

  if (
    session.state.startsWith("withdraw_") ||
    (session.state === "balance" && command === "1") ||
    command === "TARIK" ||
    command === "TARIK SALDO"
  ) {
    const withdrawalResponse =
      await handleWithdrawal(
        env.DB,
        member,
        text,
        env
      );

    if (withdrawalResponse) {
      return withdrawalResponse;
    }
  }

  // ------------------------------------------------------------
  // PROSES SESSION PEMBELIAN
  // ------------------------------------------------------------

  if (
    session.state.startsWith("purchase_") ||
    command === "BELI" ||
    command === "BELI PRODUK" ||
    command === "VERIFIKASI PEMBELIAN"
  ) {
    const purchaseResponse =
      await handlePurchase(
        env.DB,
        member,
        text,
        env
      );

    if (purchaseResponse) {
      return purchaseResponse;
    }
  }

  // ------------------------------------------------------------
  // BAB 11 — HANDLER LOGIN HARIAN
  // ------------------------------------------------------------

  if (
    command === "LOGIN" ||
    command === "LOGIN HARIAN" ||
    command === "5"
  ) {
    const today =
      getIndonesiaDate();

    // Tampilkan status terlebih dahulu
    if (
      member.daily_login_date === today
    ) {
      return dailyLoginPage(member);
    }

    const result =
      await processDailyLogin(
        env.DB,
        member
      );

    if (
      !result.success
    ) {
      return [
        "---------------------------",
        "       LOGIN HARIAN",
        "---------------------------",
        "",
        safeText(result.message),
        "",
        "Silakan kembali lagi besok.",
        "",
        "0. Kembali",
        "00. Menu Utama",
        "---------------------------"
      ].join("\n");
    }

    return dailyLoginSuccessPage(
      result
    );
  }

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
      await setSession(
        env.DB,
        member.whatsapp,
        "balance",
        {}
      );

      return balancePage(member, env);

    case "PRODUK":
    case "3":
      await sendText(
        env,
        whatsapp,
        productPage(env)
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
  return [
    "---------------------------",
    "       🌿 HERBALINDO",
    "---------------------------",
    "",
    "1. PROFIL",
    "2. SALDO",
    "3. PRODUK",
    "4. DOWNLOAD APLIKASI",
    "5. LOGIN HARIAN",
    "6. UNDANG TEMAN",
    "",
    "Ketik nomor menu.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
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


// ============================================================
// BAB 7 — ID WITHDRAWAL
// ============================================================

function generateWithdrawalId() {
  const now = new Date();

  const timestamp =
    now.getTime().toString(36).toUpperCase();

  const random =
    Math.floor(1000 + Math.random() * 9000);

  return `WD-${timestamp}-${random}`;
}


// ============================================================
// BAB 7 — PROSES PENARIKAN
// ============================================================

async function createWithdrawal(DB, member, data) {
  const amount = Number(data.amount);

  if (!WITHDRAWAL_AMOUNTS.includes(amount)) {
    return {
      success: false,
      message: "Nominal penarikan tidak tersedia."
    };
  }

  const requiredPoints = amount * 100;

  // Pastikan saldo mencukupi.
  if (Number(member.points) < requiredPoints) {
    return {
      success: false,
      message:
        `Saldo tidak mencukupi.\n\n` +
        `Saldo Anda: ${formatRupiah(calculateBalance(member.points))}\n` +
        `Penarikan: ${formatRupiah(amount)}`
    };
  }

  const withdrawalId = data.withdrawalId || generateWithdrawalId();

  const transactionId =
    generateTransactionId("WD");

  /*
   * Pengurangan saldo dan pencatatan transaksi
   * dilakukan dalam batch D1.
   */
  const results = await DB.batch([
    DB.prepare(`
      UPDATE members
      SET
        points = points - ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE member_id = ?
        AND points >= ?
    `).bind(
      requiredPoints,
      member.member_id,
      requiredPoints
    ),

    DB.prepare(`
      INSERT INTO withdrawals (
        withdrawal_id,
        member_id,
        amount,
        method,
        account_number,
        account_name,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      withdrawalId,
      member.member_id,
      amount,
      data.method,
      data.accountNumber,
      data.accountName
    ),

    DB.prepare(`
      INSERT INTO transactions (
        transaction_id,
        member_id,
        type,
        points,
        amount,
        description
      )
      VALUES (?, ?, 'WITHDRAWAL', ?, ?, ?)
    `).bind(
      transactionId,
      member.member_id,
      -requiredPoints,
      -amount,
      `Penarikan ${formatRupiah(amount)} via ${data.method}`
    )
  ]);

  const updateResult = results[0];

  if (!updateResult || updateResult.meta.changes !== 1) {
    return {
      success: false,
      message: "Saldo berubah atau tidak mencukupi. Silakan coba lagi."
    };
  }

  return {
    success: true,
    withdrawalId,
    transactionId,
    amount,
    requiredPoints
  };
}


// ============================================================
// BAB 7 — PENARIKAN BERHASIL
// ============================================================

function withdrawalSuccessPage(result, newBalance) {
  return [
    "---------------------------",
    "    ✅ PENARIKAN DIAJUKAN",
    "---------------------------",
    "",
    "Permintaan penarikan berhasil",
    "dibuat dan menunggu proses admin.",
    "",
    `ID TRANSAKSI : ${safeText(result.withdrawalId)}`,
    `NOMINAL      : ${formatRupiah(result.amount)}`,
    "STATUS       : PENDING",
    "",
    `SALDO SEKARANG: ${formatRupiah(newBalance)}`,
    "",
    "Mohon tunggu proses pencairan.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 7 — WITHDRAWAL HANDLER
// ============================================================

async function handleWithdrawal(DB, member, text, env) {
  const command = normalizeCommand(text);
  const session = await getSession(DB, member.whatsapp);

  // --------------------------------------------------------
  // MULAI TARIK SALDO
  // --------------------------------------------------------

  if (
    command === "TARIK" ||
    command === "TARIK SALDO"
  ) {
    await setSession(
      DB,
      member.whatsapp,
      "withdraw_amount",
      {}
    );

    return withdrawalAmountPage();
  }

  // --------------------------------------------------------
  // HALAMAN SALDO -> PILIH TARIK
  // --------------------------------------------------------

  if (
    session.state === "balance" &&
    command === "1"
  ) {
    await setSession(
      DB,
      member.whatsapp,
      "withdraw_amount",
      {}
    );

    return withdrawalAmountPage();
  }

  // --------------------------------------------------------
  // PILIH NOMINAL
  // --------------------------------------------------------

  if (session.state === "withdraw_amount") {
    const choice = Number(command);

    if (
      !Number.isInteger(choice) ||
      choice < 1 ||
      choice > WITHDRAWAL_AMOUNTS.length
    ) {
      return [
        "Pilihan tidak valid.",
        "",
        withdrawalAmountPage()
      ].join("\n");
    }

    const amount =
      WITHDRAWAL_AMOUNTS[choice - 1];

    const balance =
      calculateBalance(member.points);

    if (balance < amount) {
      return [
        "---------------------------",
        "     SALDO TIDAK CUKUP",
        "---------------------------",
        "",
        `Saldo Anda : ${formatRupiah(balance)}`,
        `Penarikan  : ${formatRupiah(amount)}`,
        "",
        "Silakan pilih nominal yang",
        "sesuai dengan saldo Anda.",
        "",
        "0. Kembali",
        "00. Menu Utama",
        "---------------------------"
      ].join("\n");
    }

    await setSession(
      DB,
      member.whatsapp,
      "withdraw_method",
      {
        amount
      }
    );

    return withdrawalMethodPage(amount);
  }

  // --------------------------------------------------------
  // PILIH METODE
  // --------------------------------------------------------

  if (session.state === "withdraw_method") {
    const methods = {
      "1": "DANA",
      "2": "OVO",
      "3": "GOPAY"
    };

    const method = methods[command];

    if (!method) {
      return [
        "Pilihan metode tidak valid.",
        "",
        withdrawalMethodPage(session.data.amount)
      ].join("\n");
    }

    await setSession(
      DB,
      member.whatsapp,
      "withdraw_account",
      {
        amount: session.data.amount,
        method
      }
    );

    return withdrawalAccountPage(
      method,
      session.data.amount
    );
  }

  // --------------------------------------------------------
  // INPUT NOMOR AKUN
  // --------------------------------------------------------

  if (session.state === "withdraw_account") {
    const accountNumber =
      String(text || "").trim();

    const digits =
      accountNumber.replace(/\D/g, "");

    if (
      digits.length < 8 ||
      digits.length > 20
    ) {
      return [
        "Nomor akun tidak valid.",
        "",
        "Kirim nomor DANA / OVO / GOPAY",
        "yang benar.",
        "",
        "Contoh: 081234567890"
      ].join("\n");
    }

    await setSession(
      DB,
      member.whatsapp,
      "withdraw_account_name",
      {
        amount: session.data.amount,
        method: session.data.method,
        accountNumber: digits
      }
    );

    return withdrawalAccountNamePage(
      session.data.method,
      session.data.amount,
      digits
    );
  }

  // --------------------------------------------------------
  // INPUT NAMA PEMILIK
  // --------------------------------------------------------

  if (
    session.state === "withdraw_account_name"
  ) {
    const accountName =
      String(text || "").trim();

    if (
      accountName.length < 2 ||
      accountName.length > 100
    ) {
      return [
        "Nama pemilik tidak valid.",
        "",
        "Silakan kirim nama pemilik",
        "akun yang benar."
      ].join("\n");
    }

    const withdrawalId =
      generateWithdrawalId();

    const data = {
      amount: session.data.amount,
      method: session.data.method,
      accountNumber: session.data.accountNumber,
      accountName,
      withdrawalId
    };

    await setSession(
      DB,
      member.whatsapp,
      "withdraw_confirm",
      data
    );

    return withdrawalConfirmationPage(
      member,
      data
    );
  }

  // --------------------------------------------------------
  // KONFIRMASI
  // --------------------------------------------------------

  if (session.state === "withdraw_confirm") {
    if (command === "1" || command === "YA") {

      const result =
        await createWithdrawal(
          DB,
          member,
          session.data
        );

      if (!result.success) {
        await clearSession(
          DB,
          member.whatsapp
        );

        return [
          "---------------------------",
          "   ❌ PENARIKAN GAGAL",
          "---------------------------",
          "",
          safeText(result.message),
          "",
          "00. Menu Utama",
          "---------------------------"
        ].join("\n");
      }

      const updatedMember =
        await getMemberByMemberId(
          DB,
          member.member_id
        );

      await clearSession(
        DB,
        member.whatsapp
      );

      return withdrawalSuccessPage(
        result,
        calculateBalance(updatedMember.points)
      );
    }

    if (
      command === "2" ||
      command === "BATAL"
    ) {
      await clearSession(
        DB,
        member.whatsapp
      );

      return [
        "---------------------------",
        "   PENARIKAN DIBATALKAN",
        "---------------------------",
        "",
        "Permintaan penarikan tidak jadi",
        "diajukan.",
        "",
        "Saldo Anda tetap aman.",
        "",
        "00. Menu Utama",
        "---------------------------"
      ].join("\n");
    }

    return [
      "Pilihan tidak valid.",
      "",
      withdrawalConfirmationPage(
        member,
        session.data
      )
    ].join("\n");
  }

  return null;
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


// ============================================================
// BAB 10 — PRODUK MEMBER
// ============================================================

function productPage(env) {
  const catalogUrl =
    env.WHATSAPP_CATALOG_URL || "";

  return [
    "---------------------------",
    "       🛍️ HERBALINDO",
    "          PRODUK",
    "---------------------------",
    "",
    "Silakan lihat produk resmi",
    "HERBALINDO melalui WhatsApp",
    "Catalog.",
    "",
    catalogUrl
      ? `KATALOG:\n${catalogUrl}`
      : "Katalog belum dikonfigurasi.",
    "",
    "Setelah melakukan pembelian,",
    "gunakan:",
    "",
    "BELI",
    "",
    "untuk mengajukan verifikasi",
    "pembelian.",
    "",
    "Reward:",
    "Rp500 / produk",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 9 — MULAI PENGAJUAN PEMBELIAN
// ============================================================

function purchaseStartPage() {
  return [
    "---------------------------",
    "     VERIFIKASI PEMBELIAN",
    "---------------------------",
    "",
    "Silakan kirim nama produk",
    "yang telah Anda beli.",
    "",
    "Contoh:",
    "HERBAL DIET ALAMI",
    "",
    "Pastikan nama produk sesuai",
    "dengan produk yang dibeli.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 9 — JUMLAH PRODUK
// ============================================================

function purchaseQuantityPage(productName) {
  return [
    "---------------------------",
    "       JUMLAH PRODUK",
    "---------------------------",
    "",
    `Produk: ${safeText(productName)}`,
    "",
    "Berapa jumlah produk yang dibeli?",
    "",
    "Contoh:",
    "1",
    "",
    "Kirim jumlah dalam angka.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 9 — TOTAL PEMBELIAN
// ============================================================

function purchaseAmountPage(productName, quantity) {
  return [
    "---------------------------",
    "      TOTAL PEMBELIAN",
    "---------------------------",
    "",
    `Produk : ${safeText(productName)}`,
    `Jumlah : ${quantity}`,
    "",
    "Kirim total harga pembelian",
    "dalam Rupiah.",
    "",
    "Contoh:",
    "50000",
    "",
    "Jangan menggunakan titik atau koma.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 9 — KONFIRMASI PEMBELIAN
// ============================================================

function purchaseConfirmationPage(data) {
  return [
    "---------------------------",
    "    KONFIRMASI PEMBELIAN",
    "---------------------------",
    "",
    `PRODUK   : ${safeText(data.productName)}`,
    `JUMLAH   : ${data.quantity}`,
    `TOTAL    : ${formatRupiah(data.totalAmount)}`,
    "",
    "REWARD:",
    "Rp500 / produk",
    "",
    `TOTAL REWARD: ${formatRupiah(
      data.quantity * 500
    )}`,
    "",
    "Apakah data sudah benar?",
    "",
    "1. YA, KIRIM VERIFIKASI",
    "2. BATAL",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
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
async function processDailyLogin(
  DB,
  member
) {
  const today =
    getIndonesiaDate();

  const rewardRupiah = 100;

  const rewardPoints =
    rewardRupiah * 100;

  const transactionId =
    generateTransactionId("LOGIN");

  /*
   * UPDATE menggunakan kondisi tanggal.
   *
   * Hanya satu request yang dapat berhasil
   * apabila terjadi dua request bersamaan.
   */

  const results = await DB.batch([
    DB.prepare(`
      UPDATE members
      SET
        points = points + ?,
        daily_login_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE member_id = ?
        AND (
              daily_login_date IS NULL
              OR daily_login_date != ?
            )
    `).bind(
      rewardPoints,
      today,
      member.member_id,
      today
    ),

    DB.prepare(`
      INSERT INTO transactions (
        transaction_id,
        member_id,
        type,
        points,
        amount,
        description
      )
      SELECT
        ?,
        ?,
        'DAILY_LOGIN',
        ?,
        ?,
        ?
      WHERE EXISTS (
        SELECT 1
        FROM members
        WHERE member_id = ?
          AND daily_login_date = ?
      )
    `).bind(
      transactionId,
      member.member_id,
      rewardPoints,
      rewardRupiah,
      `Reward login harian ${today}`,
      member.member_id,
      today
    )
  ]);

  if (
    !results[0] ||
    results[0].meta.changes !== 1
  ) {
    return {
      success: false,
      alreadyClaimed: true,
      message:
        "Anda sudah mengambil reward login hari ini."
    };
  }

  const updatedMember =
    await getMemberByMemberId(
      DB,
      member.member_id
    );

  return {
    success: true,
    alreadyClaimed: false,
    transactionId,
    rewardRupiah,
    rewardPoints,
    member: updatedMember
  };
}


/**
 * ============================================
 * HALAMAN LOGIN HARIAN
 * ============================================
 */
function dailyLoginPage(member) {
  const today =
    getIndonesiaDate();

  const alreadyClaimed =
    member.daily_login_date === today;

  if (alreadyClaimed) {
    return [
      "---------------------------",
      "       🎁 LOGIN HARIAN",
      "---------------------------",
      "",
      "Anda sudah mendapatkan",
      "reward login hari ini.",
      "",
      "REWARD:",
      "Rp100",
      "",
      `Tanggal: ${today}`,
      "",
      "Silakan kembali lagi besok.",
      "",
      "0. Kembali",
      "00. Menu Utama",
      "---------------------------"
    ].join("\n");
  }

  return [
    "---------------------------",
    "       🎁 LOGIN HARIAN",
    "---------------------------",
    "",
    `Tanggal: ${today}`,
    "",
    "Reward hari ini:",
    "",
    "💰 Rp100",
    "⭐ 10.000 Poin",
    "",
    "Ketik:",
    "",
    "LOGIN",
    "",
    "untuk mengambil reward.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 11 — LOGIN BERHASIL
// ============================================================

function dailyLoginSuccessPage(result) {
  const balance =
    calculateBalance(
      result.member.points
    );

  return [
    "---------------------------",
    "       🎉 LOGIN BERHASIL",
    "---------------------------",
    "",
    "Reward hari ini berhasil",
    "ditambahkan ke akun Anda.",
    "",
    `REWARD : ${formatRupiah(
      result.rewardRupiah
    )}`,
    `POIN   : ${formatNumber(
      result.rewardPoints
    )}`,
    "",
    `SALDO SEKARANG: ${formatRupiah(
      balance
    )}`,
    "",
    `ID TRANSAKSI: ${safeText(
      result.transactionId
    )}`,
    "",
    "Silakan login kembali besok.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
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
    await generateUniqueMemberId(DB);

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
// --------------------------------------------
// BUAT ID MEMBER 6 DIGIT
// --------------------------------------------

function generateMemberId() {
  return String(
    Math.floor(
      100000 + Math.random() * 900000
    )
  );
}


// --------------------------------------------
// MEMASTIKAN ID MEMBER TIDAK DUPLIKAT
// --------------------------------------------

async function generateUniqueMemberId(DB) {
  for (let i = 0; i < 20; i++) {
    const memberId = generateMemberId();

    const existing =
      await getMemberByMemberId(
        DB,
        memberId
      );

    if (!existing) {
      return memberId;
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
 *
 * Pengelolaan panel admin kini ditangani oleh
 * handleAdminCommand() pada BAB 8.
 */


// ============================================================
// BAB 8 — ADMIN HANDLER
// ============================================================

async function handleAdminCommand(
  DB,
  member,
  text,
  env
) {
  if (
    !await isAdmin(
      env,
      member.whatsapp
    )
  ) {
    return null;
  }

  const command =
    normalizeCommand(text);

  // Masuk panel admin
  if (
    command === "ADMIN" ||
    command === "MENU ADMIN"
  ) {
    return adminMenu();
  }

  // Keluar admin
  if (
    command === "6" ||
    command === "KELUAR ADMIN"
  ) {
    return mainMenu();
  }

  // Daftar member
  if (command === "1") {
    return adminMemberList(DB);
  }

  // Cari member
  if (
    command === "2"
  ) {
    return [
      "---------------------------",
      "        CARI MEMBER",
      "---------------------------",
      "",
      "Kirim ID member atau nomor",
      "WhatsApp member.",
      "",
      "0. Kembali",
      "00. Menu Utama",
      "---------------------------"
    ].join("\n");
  }

  // Permintaan withdrawal
  if (command === "5") {
    return adminWithdrawalList(DB);
  }

  // Pembelian pending
  if (command === "7") {
    return adminPurchaseList(DB);
  }

  // ------------------------------------------------------------
  // BAB 10 — PERINTAH ADMIN PRODUK
  // ------------------------------------------------------------

  // Daftar produk
  if (command === "8") {
    return adminProductList(DB);
  }

  // Tambah produk
  if (
    command === "TAMBAH PRODUK" ||
    command === "ADD PRODUK"
  ) {
    await setSession(
      DB,
      member.whatsapp,
      "admin_product_name",
      {}
    );

    return adminAddProductPage();
  }

  // Aktif / nonaktif produk
  if (
    command.startsWith("TOGGLE PRODUK ")
  ) {
    const productId =
      text.substring(14).trim();

    return adminToggleProduct(
      DB,
      productId
    );
  }

  // Approve pembelian
  if (command.startsWith("APPROVE BUY-")) {
    const purchaseId =
      text.substring(8).trim();

    return approvePurchase(
      DB,
      purchaseId,
      member.whatsapp
    );
  }

  // APPROVE
  if (
    command.startsWith("APPROVE ")
  ) {
    const withdrawalId =
      text.substring(8).trim();

    return processAdminWithdrawal(
      DB,
      withdrawalId,
      "approve",
      member.whatsapp
    );
  }

  // REJECT
  if (
    command.startsWith("REJECT ")
  ) {
    const withdrawalId =
      text.substring(7).trim();

    return processAdminWithdrawal(
      DB,
      withdrawalId,
      "reject",
      member.whatsapp
    );
  }

  // ------------------------------------------------------------
  // BAB 10 — HANDLER TAMBAH PRODUK
  // ------------------------------------------------------------

  const session =
    await getSession(
      DB,
      member.whatsapp
    );

  // Nama produk
  if (
    session.state === "admin_product_name"
  ) {
    const productName =
      String(text || "").trim();

    if (
      productName.length < 2 ||
      productName.length > 150
    ) {
      return [
        "Nama produk tidak valid.",
        "",
        "Silakan kirim nama produk lagi."
      ].join("\n");
    }

    await setSession(
      DB,
      member.whatsapp,
      "admin_product_price",
      {
        productName
      }
    );

    return adminProductPricePage(
      productName
    );
  }

  // Harga
  if (
    session.state === "admin_product_price"
  ) {
    const price =
      Number(
        String(text || "")
          .replace(/\D/g, "")
      );

    if (
      !Number.isInteger(price) ||
      price < 0
    ) {
      return [
        "Harga tidak valid.",
        "",
        "Contoh:",
        "25000"
      ].join("\n");
    }

    await setSession(
      DB,
      member.whatsapp,
      "admin_product_reward",
      {
        productName:
          session.data.productName,
        price
      }
    );

    return adminProductRewardPage(
      session.data.productName,
      price
    );
  }

  // Reward
  if (
    session.state === "admin_product_reward"
  ) {
    const reward =
      Number(
        String(text || "")
          .replace(/\D/g, "")
      );

    if (
      !Number.isInteger(reward) ||
      reward < 0
    ) {
      return [
        "Reward tidak valid.",
        "",
        "Contoh:",
        "500"
      ].join("\n");
    }

    const result =
      await createProduct(
        DB,
        session.data.productName,
        session.data.price,
        reward
      );

    await clearSession(
      DB,
      member.whatsapp
    );

    if (!result.success) {
      return safeText(
        result.message
      );
    }

    return adminProductCreatedPage(
      result
    );
  }

  return null;
}


// ============================================================
// BAB 8 — SESSION ADMIN
// ============================================================

async function isAdmin(env, whatsapp) {
  const adminNumber =
    normalizePhone(env.ADMIN_WHATSAPP || "6285813899649");

  return normalizePhone(whatsapp) === adminNumber;
}

function adminMenu() {
  return [
    "---------------------------",
    "       🔐 ADMIN PANEL",
    "---------------------------",
    "",
    "1. DAFTAR MEMBER",
    "2. CARI MEMBER",
    "3. BLOKIR / BUKA BLOKIR",
    "4. TAMBAH / KURANGI SALDO",
    "5. PERMINTAAN WITHDRAW",
    "6. KELUAR ADMIN",
    "7. PEMBELIAN PENDING",
    "8. DAFTAR PRODUK",
    "",
    "PERINTAH PRODUK:",
    "TAMBAH PRODUK",
    "TOGGLE PRODUK ID",
    "",
    "PERINTAH PEMBELIAN:",
    "APPROVE BUY-ID",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 8 — DAFTAR MEMBER
// ============================================================

async function adminMemberList(DB) {
  const result = await DB.prepare(`
    SELECT
      member_id,
      name,
      whatsapp,
      points,
      status,
      created_at
    FROM members
    ORDER BY id DESC
    LIMIT 20
  `).all();

  if (!result.results || result.results.length === 0) {
    return [
      "---------------------------",
      "       DAFTAR MEMBER",
      "---------------------------",
      "",
      "Belum ada member.",
      "",
      "0. Kembali",
      "00. Menu Utama",
      "---------------------------"
    ].join("\n");
  }

  const lines = [
    "---------------------------",
    "       DAFTAR MEMBER",
    "---------------------------",
    ""
  ];

  for (const member of result.results) {
    lines.push(
      `ID: ${safeText(member.member_id)}`,
      `Nama: ${safeText(member.name)}`,
      `WA: ${safeText(formatPhone(member.whatsapp))}`,
      `Saldo: ${formatRupiah(calculateBalance(member.points))}`,
      `Status: ${safeText(member.status)}`,
      "---------------------------"
    );
  }

  lines.push(
    "",
    "Menampilkan maksimal 20 member.",
    "",
    "0. Kembali",
    "00. Menu Utama"
  );

  return lines.join("\n");
}


// ============================================================
// BAB 8 — CARI MEMBER
// ============================================================

async function adminSearchMember(DB, keyword) {
  const value = String(keyword || "").trim();

  if (!value) {
    return [
      "---------------------------",
      "        CARI MEMBER",
      "---------------------------",
      "",
      "Kirim ID MEMBER atau nomor",
      "WhatsApp yang ingin dicari.",
      "",
      "Contoh:",
      "123456",
      "6285812345678",
      "",
      "0. Kembali",
      "00. Menu Utama",
      "---------------------------"
    ].join("\n");
  }

  const phone = normalizePhone(value);

  const member = await DB.prepare(`
    SELECT
      member_id,
      name,
      whatsapp,
      points,
      status,
      referred_by,
      created_at
    FROM members
    WHERE member_id = ?
       OR whatsapp = ?
    LIMIT 1
  `).bind(value, phone).first();

  if (!member) {
    return [
      "---------------------------",
      "     MEMBER TIDAK DITEMUKAN",
      "---------------------------",
      "",
      `Pencarian: ${safeText(value)}`,
      "",
      "0. Kembali",
      "00. Menu Utama",
      "---------------------------"
    ].join("\n");
  }

  return [
    "---------------------------",
    "       DETAIL MEMBER",
    "---------------------------",
    "",
    `ID MEMBER : ${safeText(member.member_id)}`,
    `NAMA      : ${safeText(member.name)}`,
    `WHATSAPP  : ${safeText(formatPhone(member.whatsapp))}`,
    `POIN      : ${formatNumber(member.points)}`,
    `SALDO     : ${formatRupiah(calculateBalance(member.points))}`,
    `STATUS    : ${safeText(member.status)}`,
    `REFERRAL  : ${safeText(member.referred_by || "-")}`,
    `DAFTAR    : ${safeText(member.created_at)}`,
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 8 — BLOKIR / BUKA BLOKIR
// ============================================================

async function adminToggleBlock(DB, memberId) {
  const member = await getMemberByMemberId(
    DB,
    String(memberId || "").trim()
  );

  if (!member) {
    return "Member tidak ditemukan.";
  }

  // Jangan sampai admin memblokir dirinya sendiri.
  if (
    normalizePhone(member.whatsapp) ===
    normalizePhone("6285813899649")
  ) {
    return "Akun admin tidak dapat diblokir.";
  }

  const newStatus =
    member.status === "blocked"
      ? "active"
      : "blocked";

  await DB.prepare(`
    UPDATE members
    SET
      status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE member_id = ?
  `).bind(
    newStatus,
    member.member_id
  ).run();

  return [
    "---------------------------",
    "      STATUS MEMBER",
    "---------------------------",
    "",
    `ID MEMBER : ${safeText(member.member_id)}`,
    `NAMA      : ${safeText(member.name)}`,
    "",
    `STATUS BARU: ${newStatus.toUpperCase()}`,
    "",
    "Perubahan berhasil disimpan.",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 8 — TAMBAH / KURANGI SALDO
// ============================================================

async function adminChangeBalance(
  DB,
  memberId,
  amount,
  mode
) {
  const member = await getMemberByMemberId(
    DB,
    String(memberId || "").trim()
  );

  if (!member) {
    return {
      success: false,
      message: "Member tidak ditemukan."
    };
  }

  const rupiah = Number(amount);

  if (
    !Number.isInteger(rupiah) ||
    rupiah <= 0
  ) {
    return {
      success: false,
      message: "Nominal tidak valid."
    };
  }

  const points = rupiah * 100;

  if (mode === "kurangi") {
    if (Number(member.points) < points) {
      return {
        success: false,
        message:
          "Saldo member tidak mencukupi untuk dikurangi."
      };
    }
  }

  const pointChange =
    mode === "tambah"
      ? points
      : -points;

  const transactionId =
    generateTransactionId("ADM");

  const result = await DB.batch([
    DB.prepare(`
      UPDATE members
      SET
        points = points + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE member_id = ?
        AND (
              ? > 0
              OR points >= ?
            )
    `).bind(
      pointChange,
      member.member_id,
      pointChange,
      points
    ),

    DB.prepare(`
      INSERT INTO transactions (
        transaction_id,
        member_id,
        type,
        points,
        amount,
        description
      )
      VALUES (?, ?, 'ADMIN_ADJUSTMENT', ?, ?, ?)
    `).bind(
      transactionId,
      member.member_id,
      pointChange,
      mode === "tambah"
        ? rupiah
        : -rupiah,
      mode === "tambah"
        ? `Admin menambah saldo ${formatRupiah(rupiah)}`
        : `Admin mengurangi saldo ${formatRupiah(rupiah)}`
    )
  ]);

  if (
    !result[0] ||
    result[0].meta.changes !== 1
  ) {
    return {
      success: false,
      message: "Perubahan saldo gagal."
    };
  }

  const updated =
    await getMemberByMemberId(
      DB,
      member.member_id
    );

  return {
    success: true,
    member: updated,
    transactionId
  };
}


// ============================================================
// BAB 8 — PERMINTAAN WITHDRAW
// ============================================================

async function adminWithdrawalList(DB) {
  const result = await DB.prepare(`
    SELECT
      w.withdrawal_id,
      w.member_id,
      m.name,
      m.whatsapp,
      w.amount,
      w.method,
      w.account_number,
      w.account_name,
      w.status,
      w.created_at
    FROM withdrawals w
    JOIN members m
      ON m.member_id = w.member_id
    WHERE w.status = 'pending'
    ORDER BY w.id ASC
    LIMIT 20
  `).all();

  if (
    !result.results ||
    result.results.length === 0
  ) {
    return [
      "---------------------------",
      "   PERMINTAAN WITHDRAW",
      "---------------------------",
      "",
      "Tidak ada withdraw pending.",
      "",
      "0. Kembali",
      "00. Menu Utama",
      "---------------------------"
    ].join("\n");
  }

  const lines = [
    "---------------------------",
    "   PERMINTAAN WITHDRAW",
    "---------------------------",
    ""
  ];

  for (const item of result.results) {
    lines.push(
      `ID: ${safeText(item.withdrawal_id)}`,
      `Member: ${safeText(item.member_id)}`,
      `Nama: ${safeText(item.name)}`,
      `WA: ${safeText(formatPhone(item.whatsapp))}`,
      `Nominal: ${formatRupiah(item.amount)}`,
      `Metode: ${safeText(item.method)}`,
      `Akun: ${safeText(item.account_number)}`,
      `Nama Akun: ${safeText(item.account_name)}`,
      `Status: ${safeText(item.status)}`,
      `Tanggal: ${safeText(item.created_at)}`,
      "---------------------------"
    );
  }

  lines.push(
    "",
    "Untuk memproses:",
    "APPROVE ID_WITHDRAW",
    "atau",
    "REJECT ID_WITHDRAW",
    "",
    "0. Kembali",
    "00. Menu Utama"
  );

  return lines.join("\n");
}


// ============================================================
// BAB 8 — APPROVE / REJECT WITHDRAW
// ============================================================

async function processAdminWithdrawal(
  DB,
  withdrawalId,
  action,
  adminWhatsapp
) {
  const withdrawal =
    await DB.prepare(`
      SELECT
        withdrawal_id,
        member_id,
        amount,
        method,
        account_number,
        account_name,
        status
      FROM withdrawals
      WHERE withdrawal_id = ?
      LIMIT 1
    `).bind(
      withdrawalId
    ).first();

  if (!withdrawal) {
    return "ID withdraw tidak ditemukan.";
  }

  if (withdrawal.status !== "pending") {
    return [
      "Withdraw sudah diproses.",
      "",
      `Status: ${withdrawal.status.toUpperCase()}`
    ].join("\n");
  }

  const points =
    Number(withdrawal.amount) * 100;

  // --------------------------------------------------------
  // APPROVE
  // --------------------------------------------------------

  if (action === "approve") {
    await DB.prepare(`
      UPDATE withdrawals
      SET
        status = 'approved',
        processed_at = CURRENT_TIMESTAMP,
        processed_by = ?
      WHERE withdrawal_id = ?
        AND status = 'pending'
    `).bind(
      adminWhatsapp,
      withdrawalId
    ).run();

    return [
      "---------------------------",
      "   ✅ WITHDRAW APPROVED",
      "---------------------------",
      "",
      `ID       : ${safeText(withdrawal.withdrawal_id)}`,
      `Member   : ${safeText(withdrawal.member_id)}`,
      `Nominal  : ${formatRupiah(withdrawal.amount)}`,
      `Metode   : ${safeText(withdrawal.method)}`,
      `Akun     : ${safeText(withdrawal.account_number)}`,
      `Pemilik  : ${safeText(withdrawal.account_name)}`,
      "",
      "Status: APPROVED",
      "---------------------------"
    ].join("\n");
  }

  // --------------------------------------------------------
  // REJECT + REFUND
  // --------------------------------------------------------

  if (action === "reject") {
    const transactionId =
      generateTransactionId("REFUND");

    const results = await DB.batch([
      DB.prepare(`
        UPDATE withdrawals
        SET
          status = 'rejected',
          processed_at = CURRENT_TIMESTAMP,
          processed_by = ?
        WHERE withdrawal_id = ?
          AND status = 'pending'
      `).bind(
        adminWhatsapp,
        withdrawalId
      ),

      DB.prepare(`
        UPDATE members
        SET
          points = points + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE member_id = ?
      `).bind(
        points,
        withdrawal.member_id
      ),

      DB.prepare(`
        INSERT INTO transactions (
          transaction_id,
          member_id,
          type,
          points,
          amount,
          description
        )
        VALUES (?, ?, 'WITHDRAWAL_REFUND', ?, ?, ?)
      `).bind(
        transactionId,
        withdrawal.member_id,
        points,
        withdrawal.amount,
        `Refund withdraw ${withdrawal.withdrawal_id}`
      )
    ]);

    if (
      !results[0] ||
      results[0].meta.changes !== 1
    ) {
      return "Withdraw gagal diproses atau sudah diproses sebelumnya.";
    }

    return [
      "---------------------------",
      "   ❌ WITHDRAW DITOLAK",
      "---------------------------",
      "",
      `ID       : ${safeText(withdrawal.withdrawal_id)}`,
      `Member   : ${safeText(withdrawal.member_id)}`,
      `Nominal  : ${formatRupiah(withdrawal.amount)}`,
      `Metode   : ${safeText(withdrawal.method)}`,
      "",
      "Status: REJECTED",
      "",
      "Saldo member telah dikembalikan.",
      "---------------------------"
    ].join("\n");
  }

  return "Perintah tidak valid.";
}


// ============================================================
// BAB 9 — ID PEMBELIAN
// ============================================================

function generatePurchaseId() {
  const now = new Date();

  const timestamp =
    now.getTime().toString(36).toUpperCase();

  const random =
    Math.floor(1000 + Math.random() * 9000);

  return `BUY-${timestamp}-${random}`;
}


// ============================================================
// BAB 9 — SIMPAN PEMBELIAN
// ============================================================

async function createPurchase(
  DB,
  member,
  data
) {
  const quantity =
    Number(data.quantity);

  const totalAmount =
    Number(data.totalAmount);

  if (
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {
    return {
      success: false,
      message: "Jumlah produk tidak valid."
    };
  }

  if (
    !Number.isInteger(totalAmount) ||
    totalAmount <= 0
  ) {
    return {
      success: false,
      message: "Total pembelian tidak valid."
    };
  }

  const purchaseId =
    generatePurchaseId();

  const rewardPoints =
    quantity * 50000;

  await DB.prepare(`
    INSERT INTO purchases (
      purchase_id,
      member_id,
      product_name,
      quantity,
      total_amount,
      reward_points,
      status,
      reward_given
    )
    VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)
  `).bind(
    purchaseId,
    member.member_id,
    data.productName,
    quantity,
    totalAmount,
    rewardPoints
  ).run();

  return {
    success: true,
    purchaseId,
    rewardPoints
  };
}


// ============================================================
// BAB 9 — VERIFIKASI BERHASIL
// ============================================================

function purchasePendingPage(result) {
  return [
    "---------------------------",
    "   ✅ PEMBELIAN TERKIRIM",
    "---------------------------",
    "",
    "Data pembelian berhasil",
    "dikirim untuk verifikasi admin.",
    "",
    `ID PEMBELIAN : ${safeText(
      result.purchaseId
    )}`,
    "",
    "STATUS : PENDING",
    "",
    "Reward akan diberikan setelah",
    "pembelian disetujui admin.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 9 — APPROVE PEMBELIAN
// ============================================================

async function approvePurchase(
  DB,
  purchaseId,
  adminWhatsapp
) {
  const purchase =
    await DB.prepare(`
      SELECT
        purchase_id,
        member_id,
        product_name,
        quantity,
        total_amount,
        reward_points,
        status,
        reward_given
      FROM purchases
      WHERE purchase_id = ?
      LIMIT 1
    `).bind(
      purchaseId
    ).first();

  if (!purchase) {
    return "ID pembelian tidak ditemukan.";
  }

  if (purchase.status !== "pending") {
    return [
      "Pembelian sudah diproses.",
      "",
      `Status: ${purchase.status.toUpperCase()}`
    ].join("\n");
  }

  if (Number(purchase.reward_given) === 1) {
    return "Reward pembelian sudah pernah diberikan.";
  }

  const transactionId =
    generateTransactionId("BUY");

  const results = await DB.batch([
    DB.prepare(`
      UPDATE purchases
      SET
        status = 'approved',
        reward_given = 1,
        processed_at = CURRENT_TIMESTAMP,
        processed_by = ?
      WHERE purchase_id = ?
        AND status = 'pending'
        AND reward_given = 0
    `).bind(
      adminWhatsapp,
      purchaseId
    ),

    DB.prepare(`
      UPDATE members
      SET
        points = points + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE member_id = ?
    `).bind(
      purchase.reward_points,
      purchase.member_id
    ),

    DB.prepare(`
      INSERT INTO transactions (
        transaction_id,
        member_id,
        type,
        points,
        amount,
        description
      )
      VALUES (
        ?,
        ?,
        'PURCHASE_REWARD',
        ?,
        ?,
        ?
      )
    `).bind(
      transactionId,
      purchase.member_id,
      purchase.reward_points,
      purchase.reward_points / 100,
      `Reward pembelian ${purchase.purchase_id}`
    )
  ]);

  if (
    !results[0] ||
    results[0].meta.changes !== 1
  ) {
    return "Pembelian gagal diproses atau sudah diproses.";
  }

  return [
    "---------------------------",
    "   ✅ PEMBELIAN DISETUJUI",
    "---------------------------",
    "",
    `ID       : ${safeText(purchase.purchase_id)}`,
    `Member   : ${safeText(purchase.member_id)}`,
    `Produk   : ${safeText(purchase.product_name)}`,
    `Jumlah   : ${purchase.quantity}`,
    `Reward   : ${formatRupiah(
      purchase.reward_points / 100
    )}`,
    "",
    "Reward berhasil ditambahkan.",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 9 — DAFTAR PEMBELIAN PENDING
// ============================================================

async function adminPurchaseList(DB) {
  const result = await DB.prepare(`
    SELECT
      p.purchase_id,
      p.member_id,
      m.name,
      m.whatsapp,
      p.product_name,
      p.quantity,
      p.total_amount,
      p.reward_points,
      p.status,
      p.created_at
    FROM purchases p
    JOIN members m
      ON m.member_id = p.member_id
    WHERE p.status = 'pending'
    ORDER BY p.id ASC
    LIMIT 20
  `).all();

  if (
    !result.results ||
    result.results.length === 0
  ) {
    return [
      "---------------------------",
      "   PEMBELIAN PENDING",
      "---------------------------",
      "",
      "Tidak ada pembelian pending.",
      "",
      "0. Kembali",
      "00. Menu Utama",
      "---------------------------"
    ].join("\n");
  }

  const lines = [
    "---------------------------",
    "   PEMBELIAN PENDING",
    "---------------------------",
    ""
  ];

  for (const item of result.results) {
    lines.push(
      `ID: ${safeText(item.purchase_id)}`,
      `Member: ${safeText(item.member_id)}`,
      `Nama: ${safeText(item.name)}`,
      `WA: ${safeText(formatPhone(item.whatsapp))}`,
      `Produk: ${safeText(item.product_name)}`,
      `Jumlah: ${item.quantity}`,
      `Total: ${formatRupiah(item.total_amount)}`,
      `Reward: ${formatRupiah(
        item.reward_points / 100
      )}`,
      `Tanggal: ${safeText(item.created_at)}`,
      "---------------------------"
    );
  }

  lines.push(
    "",
    "Untuk menyetujui:",
    "APPROVE BUY-ID",
    "",
    "Contoh:",
    "APPROVE BUY-ABC123-1234",
    "",
    "0. Kembali",
    "00. Menu Utama"
  );

  return lines.join("\n");
}


// ============================================================
// BAB 10 — DAFTAR PRODUK ADMIN
// ============================================================

async function adminProductList(DB) {
  const result = await DB.prepare(`
    SELECT
      id,
      product_name,
      price,
      reward_points,
      status,
      created_at,
      updated_at
    FROM products
    ORDER BY id DESC
    LIMIT 50
  `).all();

  if (
    !result.results ||
    result.results.length === 0
  ) {
    return [
      "---------------------------",
      "       DAFTAR PRODUK",
      "---------------------------",
      "",
      "Belum ada produk.",
      "",
      "0. Kembali",
      "00. Menu Utama",
      "---------------------------"
    ].join("\n");
  }

  const lines = [
    "---------------------------",
    "       DAFTAR PRODUK",
    "---------------------------",
    ""
  ];

  for (const product of result.results) {
    lines.push(
      `ID       : ${product.id}`,
      `PRODUK   : ${safeText(product.product_name)}`,
      `HARGA    : ${formatRupiah(product.price)}`,
      `REWARD   : ${formatRupiah(
        product.reward_points / 100
      )}`,
      `STATUS   : ${safeText(product.status)}`,
      "---------------------------"
    );
  }

  lines.push(
    "",
    "Maksimal 50 produk ditampilkan.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  );

  return lines.join("\n");
}


// ============================================================
// BAB 10 — MULAI TAMBAH PRODUK
// ============================================================

function adminAddProductPage() {
  return [
    "---------------------------",
    "       TAMBAH PRODUK",
    "---------------------------",
    "",
    "Kirim nama produk baru.",
    "",
    "Contoh:",
    "HERBAL DIET ALAMI",
    "",
    "Nama harus jelas dan mudah",
    "dikenali member.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 10 — HARGA PRODUK
// ============================================================

function adminProductPricePage(productName) {
  return [
    "---------------------------",
    "        HARGA PRODUK",
    "---------------------------",
    "",
    `Produk: ${safeText(productName)}`,
    "",
    "Kirim harga produk dalam Rupiah.",
    "",
    "Contoh:",
    "25000",
    "",
    "Jangan menggunakan titik atau koma.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 10 — REWARD PRODUK
// ============================================================

function adminProductRewardPage(
  productName,
  price
) {
  return [
    "---------------------------",
    "       REWARD PRODUK",
    "---------------------------",
    "",
    `Produk : ${safeText(productName)}`,
    `Harga  : ${formatRupiah(price)}`,
    "",
    "Kirim nominal reward dalam",
    "Rupiah.",
    "",
    "Default:",
    "500",
    "",
    "Contoh:",
    "500",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 10 — SIMPAN PRODUK
// ============================================================

async function createProduct(
  DB,
  productName,
  price,
  rewardRupiah
) {
  const name =
    String(productName || "").trim();

  const productPrice =
    Number(price);

  const reward =
    Number(rewardRupiah);

  if (
    name.length < 2 ||
    name.length > 150
  ) {
    return {
      success: false,
      message: "Nama produk tidak valid."
    };
  }

  if (
    !Number.isInteger(productPrice) ||
    productPrice < 0
  ) {
    return {
      success: false,
      message: "Harga produk tidak valid."
    };
  }

  if (
    !Number.isInteger(reward) ||
    reward < 0
  ) {
    return {
      success: false,
      message: "Reward tidak valid."
    };
  }

  const rewardPoints =
    reward * 100;

  const result = await DB.prepare(`
    INSERT INTO products (
      product_name,
      price,
      reward_points,
      status
    )
    VALUES (?, ?, ?, 'active')
  `).bind(
    name,
    productPrice,
    rewardPoints
  ).run();

  return {
    success: true,
    productId: result.meta.last_row_id,
    productName: name,
    price: productPrice,
    reward: reward,
    rewardPoints: rewardPoints
  };
}


// ============================================================
// BAB 10 — PRODUK BERHASIL DIBUAT
// ============================================================

function adminProductCreatedPage(result) {
  return [
    "---------------------------",
    "     ✅ PRODUK DITAMBAHKAN",
    "---------------------------",
    "",
    `ID PRODUK : ${result.productId}`,
    `PRODUK     : ${safeText(result.productName)}`,
    `HARGA      : ${formatRupiah(result.price)}`,
    `REWARD     : ${formatRupiah(result.reward)}`,
    `POIN       : ${formatNumber(
      result.rewardPoints
    )}`,
    "",
    "STATUS     : ACTIVE",
    "",
    "Produk berhasil disimpan.",
    "",
    "0. Kembali",
    "00. Menu Utama",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 10 — AKTIF / NONAKTIF PRODUK
// ============================================================

async function adminToggleProduct(
  DB,
  productId
) {
  const id = Number(productId);

  if (!Number.isInteger(id)) {
    return "ID produk tidak valid.";
  }

  const product =
    await DB.prepare(`
      SELECT
        id,
        product_name,
        status
      FROM products
      WHERE id = ?
      LIMIT 1
    `).bind(id).first();

  if (!product) {
    return "Produk tidak ditemukan.";
  }

  const newStatus =
    product.status === "active"
      ? "inactive"
      : "active";

  await DB.prepare(`
    UPDATE products
    SET
      status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    newStatus,
    id
  ).run();

  return [
    "---------------------------",
    "      STATUS PRODUK",
    "---------------------------",
    "",
    `ID     : ${product.id}`,
    `Produk : ${safeText(product.product_name)}`,
    "",
    `STATUS : ${newStatus.toUpperCase()}`,
    "",
    "Perubahan berhasil disimpan.",
    "---------------------------"
  ].join("\n");
}


// ============================================================
// BAB 10 — EDIT PRODUK
// ============================================================

async function adminEditProduct(
  DB,
  productId,
  price,
  rewardRupiah
) {
  const id = Number(productId);
  const newPrice = Number(price);
  const newReward = Number(rewardRupiah);

  if (
    !Number.isInteger(id) ||
    !Number.isInteger(newPrice) ||
    newPrice < 0 ||
    !Number.isInteger(newReward) ||
    newReward < 0
  ) {
    return {
      success: false,
      message: "Data produk tidak valid."
    };
  }

  const product =
    await DB.prepare(`
      SELECT id, product_name
      FROM products
      WHERE id = ?
      LIMIT 1
    `).bind(id).first();

  if (!product) {
    return {
      success: false,
      message: "Produk tidak ditemukan."
    };
  }

  const rewardPoints =
    newReward * 100;

  await DB.prepare(`
    UPDATE products
    SET
      price = ?,
      reward_points = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    newPrice,
    rewardPoints,
    id
  ).run();

  return {
    success: true,
    productName: product.product_name,
    price: newPrice,
    reward: newReward,
    rewardPoints
  };
}


// ============================================================
// BAB 9 — PROSES PENGAJUAN PEMBELIAN
// ============================================================

async function handlePurchase(DB, member, text, env) {
  const command = normalizeCommand(text);
  const session = await getSession(DB, member.whatsapp);

  // --------------------------------------------------------
  // MULAI PENGAJUAN
  // --------------------------------------------------------

  if (
    command === "BELI" ||
    command === "BELI PRODUK" ||
    command === "VERIFIKASI PEMBELIAN"
  ) {
    await setSession(
      DB,
      member.whatsapp,
      "purchase_product",
      {}
    );

    return purchaseStartPage();
  }

  // --------------------------------------------------------
  // INPUT NAMA PRODUK
  // --------------------------------------------------------

  if (session.state === "purchase_product") {
    const productName =
      String(text || "").trim();

    if (
      productName.length < 2 ||
      productName.length > 100
    ) {
      return [
        "Nama produk tidak valid.",
        "",
        purchaseStartPage()
      ].join("\n");
    }

    await setSession(
      DB,
      member.whatsapp,
      "purchase_quantity",
      {
        productName
      }
    );

    return purchaseQuantityPage(productName);
  }

  // --------------------------------------------------------
  // INPUT JUMLAH
  // --------------------------------------------------------

  if (session.state === "purchase_quantity") {
    const quantity = Number(command);

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000
    ) {
      return [
        "Jumlah produk tidak valid.",
        "",
        purchaseQuantityPage(
          session.data.productName
        )
      ].join("\n");
    }

    await setSession(
      DB,
      member.whatsapp,
      "purchase_amount",
      {
        productName: session.data.productName,
        quantity
      }
    );

    return purchaseAmountPage(
      session.data.productName,
      quantity
    );
  }

  // --------------------------------------------------------
  // INPUT TOTAL PEMBELIAN
  // --------------------------------------------------------

  if (session.state === "purchase_amount") {
    const digits =
      String(text || "")
        .replace(/[^\d]/g, "");

    const totalAmount = Number(digits);

    if (
      !Number.isInteger(totalAmount) ||
      totalAmount <= 0
    ) {
      return [
        "Total pembelian tidak valid.",
        "",
        purchaseAmountPage(
          session.data.productName,
          session.data.quantity
        )
      ].join("\n");
    }

    const data = {
      productName: session.data.productName,
      quantity: session.data.quantity,
      totalAmount
    };

    await setSession(
      DB,
      member.whatsapp,
      "purchase_confirm",
      data
    );

    return purchaseConfirmationPage(data);
  }

  // --------------------------------------------------------
  // KONFIRMASI
  // --------------------------------------------------------

  if (session.state === "purchase_confirm") {
    if (command === "1" || command === "YA") {
      const result =
        await createPurchase(
          DB,
          member,
          session.data
        );

      if (!result.success) {
        await clearSession(
          DB,
          member.whatsapp
        );

        return [
          "---------------------------",
          "   ❌ PENGAJUAN GAGAL",
          "---------------------------",
          "",
          safeText(result.message),
          "",
          "00. Menu Utama",
          "---------------------------"
        ].join("\n");
      }

      await clearSession(
        DB,
        member.whatsapp
      );

      return purchasePendingPage(result);
    }

    if (command === "2" || command === "BATAL") {
      await clearSession(
        DB,
        member.whatsapp
      );

      return [
        "---------------------------",
        "   PENGAJUAN DIBATALKAN",
        "---------------------------",
        "",
        "Pengajuan verifikasi pembelian",
        "tidak jadi dikirim.",
        "",
        "00. Menu Utama",
        "---------------------------"
      ].join("\n");
    }

    return [
      "Pilihan tidak valid.",
      "",
      purchaseConfirmationPage(
        session.data
      )
    ].join("\n");
  }

  return null;
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


// ============================================
// BAB 12
// SISTEM UNDANG TEMAN / REFERRAL
// ============================================

const REFERRAL_REWARD_RUPIAH = 1000;
const REFERRAL_REWARD_POINTS = 100000;


// --------------------------------------------
// HALAMAN UNDANG TEMAN
// --------------------------------------------

function referralPage(member, env) {
  const botNumber = normalizePhone(
    env.WHATSAPP_BOT_NUMBER || ""
  );

  let referralLink = "";

  if (botNumber) {
    referralLink =
      `https://wa.me/${botNumber}?text=DAFTAR%20${member.member_id}`;
  }

  return `
---------------------------
       👥 UNDANG TEMAN
---------------------------

Nama:
${safeText(member.name)}

ID Member:
${member.member_id}

🎁 BONUS REFERRAL

Undang teman dan dapatkan:

Rp${formatNumber(REFERRAL_REWARD_RUPIAH)}
atau
${formatNumber(REFERRAL_REWARD_POINTS)} poin

Setiap teman baru harus
melakukan pendaftaran melalui
ID referral Anda.

ID Referral Anda:
${member.member_id}

${
    referralLink
        ? `
Link Undangan:
${referralLink}
`
        : ""
}

Cara teman mendaftar:

DAFTAR ${member.member_id}

Contoh:

DAFTAR 123456

⚠️ Satu nomor WhatsApp
hanya dapat memiliki
satu akun member.

Bonus referral hanya diberikan
satu kali untuk setiap member
baru yang berhasil terdaftar.

---------------------------

0. Kembali
00. Menu Utama
---------------------------
`;
}


// --------------------------------------------
// PARSE KODE REFERRAL
// --------------------------------------------

function parseReferralCommand(text) {
  const command = normalizeCommand(text);

  const patterns = [
    /^DAFTAR\s+(\d{6})$/,
    /^REF\s+(\d{6})$/,
    /^REFERRAL\s+(\d{6})$/
  ];

  for (const pattern of patterns) {
    const match = command.match(pattern);

    if (match) {
      return match[1];
    }
  }

  return null;
}


// --------------------------------------------
// BUAT MEMBER BARU DENGAN REFERRAL
// --------------------------------------------

async function registerMember(
  DB,
  whatsapp,
  name,
  referralId = null
) {
  const normalizedWhatsapp =
    normalizePhone(whatsapp);

  // ----------------------------------------
  // CEK NOMOR SUDAH TERDAFTAR
  // ----------------------------------------

  const existing =
    await getMemberByWhatsApp(
      DB,
      normalizedWhatsapp
    );

  if (existing) {
    return {
      success: false,
      reason: "already_registered",
      member: existing
    };
  }

  // ----------------------------------------
  // VALIDASI REFERRAL
  // ----------------------------------------

  let inviter = null;

  if (referralId) {
    inviter =
      await getMemberByMemberId(
        DB,
        referralId
      );

    if (!inviter) {
      return {
        success: false,
        reason: "invalid_referral"
      };
    }

    if (
      normalizePhone(inviter.whatsapp) ===
      normalizedWhatsapp
    ) {
      return {
        success: false,
        reason: "self_referral"
      };
    }

    if (inviter.status !== "active") {
      return {
        success: false,
        reason: "inviter_blocked"
      };
    }
  }

  // ----------------------------------------
  // GENERATE MEMBER ID
  // ----------------------------------------

  const newMemberId =
    await generateUniqueMemberId(DB);

  // ----------------------------------------
  // DATA MEMBER BARU
  // ----------------------------------------

  const referredBy =
    inviter
      ? inviter.member_id
      : null;

  // ----------------------------------------
  // BUAT MEMBER
  // ----------------------------------------

  await DB
    .prepare(`
      INSERT INTO members (
        member_id,
        whatsapp,
        name,
        points,
        status,
        referred_by,
        referral_rewarded
      )
      VALUES (?, ?, ?, 0, 'active', ?, 0)
    `)
    .bind(
      newMemberId,
      normalizedWhatsapp,
      name,
      referredBy
    )
    .run();

  const newMember =
    await getMemberByMemberId(
      DB,
      newMemberId
    );

  // ----------------------------------------
  // TANPA REFERRAL
  // ----------------------------------------

  if (!inviter) {
    return {
      success: true,
      member: newMember,
      referral: false
    };
  }

  // ----------------------------------------
  // BERIKAN BONUS REFERRAL
  //
  // Semua operasi bonus dilakukan dalam
  // satu DB.batch() agar atomik.
  // ----------------------------------------

  const referralTransactionId =
    `REF-${newMemberId}`;

  try {
    await DB.batch([
      // Catat reward referral.
      //
      // UNIQUE(referred_member_id)
      // mencegah reward ganda.
      DB
        .prepare(`
          INSERT INTO referral_rewards (
            referred_member_id,
            inviter_member_id,
            reward_points
          )
          VALUES (?, ?, ?)
        `)
        .bind(
          newMemberId,
          inviter.member_id,
          REFERRAL_REWARD_POINTS
        ),

      // Tambahkan poin kepada pengundang.
      DB
        .prepare(`
          UPDATE members
          SET
            points = points + ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE member_id = ?
            AND status = 'active'
        `)
        .bind(
          REFERRAL_REWARD_POINTS,
          inviter.member_id
        ),

      // Tandai referral sudah mendapatkan
      // bonus.
      DB
        .prepare(`
          UPDATE members
          SET
            referral_rewarded = 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE member_id = ?
            AND referral_rewarded = 0
        `)
        .bind(
          newMemberId
        ),

      // Catat transaksi.
      DB
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
          referralTransactionId,
          inviter.member_id,
          "REFERRAL_REWARD",
          REFERRAL_REWARD_POINTS,
          REFERRAL_REWARD_RUPIAH,
          `Bonus referral member ${newMemberId}`
        )
    ]);
  } catch (error) {
    // Jika bonus gagal, member baru tetap
    // ada tetapi referral tidak dianggap
    // berhasil.
    return {
      success: true,
      member: newMember,
      referral: false,
      referralError: true
    };
  }

  // ----------------------------------------
  // AMBIL DATA MEMBER TERBARU
  // ----------------------------------------

  const updatedInviter =
    await getMemberByMemberId(
      DB,
      inviter.member_id
    );

  return {
    success: true,

    member: newMember,

    referral: true,

    inviter: updatedInviter,

    rewardRupiah:
      REFERRAL_REWARD_RUPIAH,

    rewardPoints:
      REFERRAL_REWARD_POINTS
  };
}


// --------------------------------------------
// HALAMAN REGISTRASI BERHASIL
// --------------------------------------------

function registrationSuccessPage(result) {
  const member = result.member;

  let referralMessage = "";

  if (result.referral && result.inviter) {
    referralMessage = `
🎁 Referral berhasil.

Pengundang:
${safeText(result.inviter.name)}

ID Pengundang:
${result.inviter.member_id}

Bonus pengundang:
Rp${formatNumber(result.rewardRupiah)}

${formatNumber(result.rewardPoints)} poin
`;
  }

  return `
---------------------------
       ✅ PENDAFTARAN
---------------------------

Pendaftaran berhasil.

Nama:
${safeText(member.name)}

ID Member:
${member.member_id}

WhatsApp:
${formatPhone(member.whatsapp)}

Saldo:
Rp0

Poin:
0

${referralMessage}

Selamat bergabung di
HERBALINDO.

Ketik:

00

untuk membuka Menu Utama.

---------------------------
`;
}


// --------------------------------------------
// PESAN JIKA SUDAH TERDAFTAR
// --------------------------------------------

function alreadyRegisteredPage(member) {
  return `
---------------------------
     ⚠️ SUDAH TERDAFTAR
---------------------------

Nomor WhatsApp ini sudah
terdaftar sebagai member.

Nama:
${safeText(member.name)}

ID Member:
${member.member_id}

Satu nomor WhatsApp hanya
dapat memiliki satu akun.

Ketik:

00

untuk Menu Utama.

---------------------------
`;
}


// --------------------------------------------
// PESAN REFERRAL TIDAK VALID
// --------------------------------------------

function invalidReferralPage() {
  return `
---------------------------
       ⚠️ REFERRAL
---------------------------

ID referral tidak ditemukan.

Pastikan ID referral terdiri
dari 6 digit dan merupakan
ID member HERBALINDO yang valid.

Contoh:

DAFTAR 123456

---------------------------

0. Kembali
00. Menu Utama
---------------------------
`;
}


// --------------------------------------------
// PESAN SELF REFERRAL
// --------------------------------------------

function selfReferralPage() {
  return `
---------------------------
       ⚠️ REFERRAL
---------------------------

Anda tidak dapat menggunakan
ID referral milik sendiri.

Gunakan ID referral milik
member lain.

---------------------------

0. Kembali
00. Menu Utama
---------------------------
`;
}


// --------------------------------------------
// PESAN INVITER DIBLOKIR
// --------------------------------------------

function blockedInviterPage() {
  return `
---------------------------
       ⚠️ REFERRAL
---------------------------

Member pemilik ID referral
tersebut sedang diblokir.

Silakan gunakan ID referral
member lain yang aktif.

---------------------------

0. Kembali
00. Menu Utama
---------------------------
`;
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
