require("dotenv").config();
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const products = [
  {
    sku: "AST-THERM-001",
    name: "Digital Thermometer",
    category: "Devices",
    description: "15 second fever detection with beep alert.",
    base_price_inr: 499,
    image_urls_json: ["https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=600&q=80"],
    audience: "employee",
  },
  {
    sku: "AST-BP-002",
    name: "BP Monitor",
    category: "Devices",
    description: "Upper arm BP monitor with large display.",
    base_price_inr: 1899,
    image_urls_json: ["https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=600&q=80"],
    audience: "employee",
  },
  {
    sku: "AST-OXI-003",
    name: "Pulse Oximeter",
    category: "Diagnostics",
    description: "SpO2 and pulse rate with OLED screen.",
    base_price_inr: 1299,
    image_urls_json: ["https://images.unsplash.com/photo-1581594693702-fbdc51b2763b?auto=format&fit=crop&w=600&q=80"],
    audience: "employee",
  },
  {
    sku: "AST-GLU-004",
    name: "Glucometer Kit",
    category: "Diagnostics",
    description: "Includes 10 strips, lancing device, and meter.",
    base_price_inr: 1599,
    image_urls_json: ["https://images.unsplash.com/photo-1580281658629-8f1725f1a0f1?auto=format&fit=crop&w=600&q=80"],
    audience: "employee",
  },
  {
    sku: "AST-GLV-005",
    name: "Disposable Gloves (100)",
    category: "Protective",
    description: "Latex-free disposable gloves pack of 100.",
    base_price_inr: 399,
    image_urls_json: ["https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=600&q=80"],
    audience: "employee",
  },
  {
    sku: "AST-MSK-006",
    name: "Surgical Masks (50)",
    category: "Protective",
    description: "3-ply surgical masks with nose clip.",
    base_price_inr: 299,
    image_urls_json: ["https://images.unsplash.com/photo-1584036561566-baf8f5f1b144?auto=format&fit=crop&w=600&q=80"],
    audience: "employee",
  },
  {
    sku: "AST-VITC-007",
    name: "Vitamin C Tablets",
    category: "Vitamins",
    description: "Immunity support with 60 tablets.",
    base_price_inr: 349,
    image_urls_json: ["https://images.unsplash.com/photo-1580915411954-282cb1da1e9b?auto=format&fit=crop&w=600&q=80"],
    audience: "employee",
  },
  {
    sku: "AST-ORS-008",
    name: "ORS Powder (10)",
    category: "Wellness",
    description: "Hydration salts, pack of 10 sachets.",
    base_price_inr: 199,
    image_urls_json: ["https://images.unsplash.com/photo-1612531386025-62c6c6d9fb61?auto=format&fit=crop&w=600&q=80"],
    audience: "employee",
  },
  {
    sku: "AST-DOC-STE-001",
    name: "Premium Stethoscope",
    category: "Diagnostic Tools",
    description: "Cardiology-grade acoustic stethoscope with soft sealing eartips.",
    base_price_inr: 2500,
    image_urls_json: ["https://images.unsplash.com/photo-1584982751601-97dcc096659c?auto=format&fit=crop&w=600&q=80"],
    audience: "doctor",
  },
  {
    sku: "AST-DOC-OTO-002",
    name: "Otoscope",
    category: "Diagnostic Tools",
    description: "High-clarity otoscope for ENT examination workflows.",
    base_price_inr: 3500,
    image_urls_json: ["https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=600&q=80"],
    audience: "doctor",
  },
  {
    sku: "AST-DOC-SAN-003",
    name: "Hand Sanitizer (500ml)",
    category: "Clinical Supplies",
    description: "Clinic-grade sanitizer for infection-safe patient handling.",
    base_price_inr: 200,
    image_urls_json: ["https://images.unsplash.com/photo-1584483766114-2cea6facdf57?auto=format&fit=crop&w=600&q=80"],
    audience: "doctor",
  },
];

async function main() {
  const now = new Date().toISOString();
  for (const product of products) {
    const { data, error } = await supabase.from("pharmacy_product_catalog").upsert({
      id: crypto.randomUUID(),
      ...product,
      is_active: true,
      updated_at: now,
    }, { onConflict: "sku" }).select("id").maybeSingle();

    if (error) {
      throw error;
    }

    const productId = data?.id;
    if (productId) {
      await supabase.from("pharmacy_inventory").upsert({
        id: crypto.randomUUID(),
        product_id: productId,
        location_code: "BLR-WH1",
        available_qty: 120,
        reserved_qty: 0,
        reorder_level: 25,
        updated_at: now,
      }, { onConflict: "product_id,location_code" });
    }
  }

  console.log(JSON.stringify({ seeded: products.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
