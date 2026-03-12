require("dotenv").config();
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const doctors = [
  {
    fullName: "Dr. Riza Yuhi",
    email: "riza.yuhi@astikan.com",
    phone: "9000000001",
    specialization: "Internal Medicine",
    qualification: "MD",
    experience: 10,
    avatarUrl: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=160&q=80",
  },
  {
    fullName: "Dr. Sarah Chen",
    email: "sarah.chen@astikan.com",
    phone: "9000000002",
    specialization: "Cardiology",
    qualification: "DM",
    experience: 12,
    avatarUrl: "https://images.unsplash.com/photo-1594824475317-6f6d4f3a04c9?auto=format&fit=crop&w=160&q=80",
  },
  {
    fullName: "Dr. Michael Park",
    email: "michael.park@astikan.com",
    phone: "9000000003",
    specialization: "Dermatology",
    qualification: "MD",
    experience: 8,
    avatarUrl: "https://images.unsplash.com/photo-1614436163996-25cee5f54290?auto=format&fit=crop&w=160&q=80",
  },
  {
    fullName: "Dr. Aarav Patel",
    email: "aarav.patel@astikan.com",
    phone: "9000000004",
    specialization: "Pulmonology",
    qualification: "MD",
    experience: 9,
    avatarUrl: "https://images.unsplash.com/photo-1582750433449-648ed127bb54?auto=format&fit=crop&w=160&q=80",
  },
  {
    fullName: "Dr. Neha Iyer",
    email: "neha.iyer@astikan.com",
    phone: "9000000005",
    specialization: "Endocrinology",
    qualification: "DM",
    experience: 11,
    avatarUrl: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=160&q=80",
  },
  {
    fullName: "Dr. Kabir Rao",
    email: "kabir.rao@astikan.com",
    phone: "9000000006",
    specialization: "Orthopedics",
    qualification: "MS",
    experience: 13,
    avatarUrl: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=160&q=80",
  },
];

async function findAuthUserByEmail(email) {
  let page = 1;
  const normalized = email.toLowerCase();
  while (page <= 10) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    const user = result.data?.users?.find((item) => item.email?.toLowerCase() === normalized);
    if (user) return user;
    if (!result.data?.users?.length || result.data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function ensureAuthUser({ email, phone, fullName, password }) {
  const existing = await findAuthUserByEmail(email);
  if (existing) return existing.id;

  const created = await supabase.auth.admin.createUser({
    email,
    phone,
    password,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? "Failed to create auth user");
  }
  return created.data.user.id;
}

async function main() {
  const now = new Date().toISOString();
  for (const doctor of doctors) {
    const userId = await ensureAuthUser({ ...doctor, password: "Doctor@123" });
    await supabase.from("app_users").upsert({
      id: userId,
      primary_role: "doctor",
      full_name: doctor.fullName,
      email: doctor.email,
      phone: doctor.phone,
      avatar_url: doctor.avatarUrl,
      status: "active",
      updated_at: now,
    });

    await supabase.from("doctor_profiles").upsert({
      user_id: userId,
      doctor_code: `DOC-${doctor.fullName.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8)}`,
      full_display_name: doctor.fullName,
      email: doctor.email,
      mobile: doctor.phone,
      highest_qualification: doctor.qualification,
      experience_years: doctor.experience,
      practice_address: "Astikan OPD Clinic",
      consultation_fee_inr: 400,
      verification_status: "verified",
      verified_at: now,
      updated_at: now,
    });

    await supabase.from("doctor_specializations").upsert({
      id: crypto.randomUUID(),
      doctor_id: userId,
      specialization_code: doctor.specialization.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      specialization_name: doctor.specialization,
    });
  }

  console.log(JSON.stringify({ seeded: doctors.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
