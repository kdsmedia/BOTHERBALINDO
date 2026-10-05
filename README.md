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
