// scripts/syncProducts.cjs
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const productsPath = path.join(rootDir, "server", "products.json");
const initialPath = path.join(rootDir, "public", "initial_products.json");

if (!fs.existsSync(productsPath)) {
  console.log("[syncProducts] server/products.json bulunamadı, atlanıyor.");
  process.exit(0);
}

try {
  const raw = fs.readFileSync(productsPath, "utf8") || "{}";
  const parsed = JSON.parse(raw);

  const itemsRaw = Array.isArray(parsed.items) ? parsed.items : [];

  // Başta VEYA sonda kaç tane olursa olsun çift tırnakları at
  const stripQuotes = (s) =>
    String(s ?? "")
      .trim()
      .replace(/^"+|"+$/g, ""); // ← ÖNEMLİ KISIM

  const items = itemsRaw
    .map((row) => {
      const gtin = stripQuotes(row.gtin);
      const brandName = stripQuotes(row.brand_name);
      return { gtin, brand_name: brandName };
    })
    .filter((row) => row.gtin && row.brand_name);

  const output = {
    lastChangeId: 0,
    items,
  };

  fs.writeFileSync(initialPath, JSON.stringify(output, null, 2), "utf8");

  console.log(
    `[syncProducts] ${items.length} ürün server/products.json -> public/initial_products.json (tırnaklar temizlenerek) senkronize edildi.`
  );
  if (items[0]) {
    console.log(
      "[syncProducts] Örnek ilk ürün:",
      items[0].gtin,
      "-",
      items[0].brand_name
    );
  }

  process.exit(0);
} catch (e) {
  console.error("[syncProducts] Hata:", e.message || e);
  process.exit(1);
}
