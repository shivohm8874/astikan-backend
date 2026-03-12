create table if not exists public.employee_health_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(user_id) on delete cascade,
  height_cm int null,
  weight_kg int null,
  waist_cm int null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (employee_id)
);

create index if not exists idx_employee_health_metrics_company_id on public.employee_health_metrics(company_id);
