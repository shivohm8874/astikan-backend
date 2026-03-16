create table if not exists public.weekend_challenges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  points integer not null default 0,
  category text not null default 'Health' check (category in ('Physical', 'Mental', 'Health', 'Lifestyle')),
  difficulty text not null default 'Easy' check (difficulty in ('Easy', 'Medium', 'Hard')),
  duration text not null default 'All day',
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.weekend_challenge_completions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(user_id) on delete cascade,
  challenge_id uuid not null references public.weekend_challenges(id) on delete cascade,
  week_start date not null,
  completed_at timestamptz not null default timezone('utc', now()),
  unique(employee_id, challenge_id, week_start)
);

create index if not exists weekend_challenge_completions_employee_id_idx
  on public.weekend_challenge_completions(employee_id);
create index if not exists weekend_challenge_completions_week_start_idx
  on public.weekend_challenge_completions(week_start);

insert into public.weekend_challenges (slug, title, description, points, category, difficulty, duration, active)
values
  ('water-intake', 'Water Intake Challenge', 'Drink at least 8 glasses of water today.', 120, 'Health', 'Easy', 'All day', true),
  ('sleep-on-time', 'Sleep On Time Challenge', 'Go to bed before your target bedtime.', 150, 'Mental', 'Medium', 'Night', true),
  ('step-challenge', 'Step Challenge', 'Reach your daily step goal.', 160, 'Physical', 'Medium', 'All day', true),
  ('stretching-challenge', 'Stretching Challenge', 'Complete a 10-minute stretching routine.', 110, 'Physical', 'Easy', '10 min', true),
  ('no-sugar', 'No Sugar Challenge', 'Avoid added sugar for the day.', 170, 'Lifestyle', 'Hard', 'All day', true),
  ('no-junk-food', 'No Junk Food Challenge', 'Skip junk food and choose clean meals.', 170, 'Lifestyle', 'Hard', 'All day', true),
  ('post-meal-walk', 'Post Meal Walk Challenge', 'Take a 10-minute walk after meals.', 130, 'Physical', 'Medium', '10 min', true),
  ('sunlight-challenge', 'Sunlight Challenge', 'Get 10 minutes of sunlight exposure.', 120, 'Health', 'Easy', '10 min', true),
  ('posture-correction', 'Posture Correction Challenge', 'Set posture reminders and follow them.', 140, 'Health', 'Medium', 'All day', true),
  ('fruit-challenge', 'Fruit Challenge', 'Eat at least 2 servings of fruit.', 120, 'Health', 'Easy', 'All day', true),
  ('protein-target', 'Protein Target Challenge', 'Meet your daily protein target.', 160, 'Health', 'Medium', 'All day', true),
  ('stair-challenge', 'Stair Challenge', 'Use stairs instead of lifts today.', 140, 'Physical', 'Medium', 'All day', true),
  ('digital-detox', 'Digital Detox Challenge', 'Stay away from screens for 60 minutes.', 150, 'Mental', 'Medium', '60 min', true),
  ('early-wakeup', 'Early Wakeup Challenge', 'Wake up before your set alarm time.', 150, 'Mental', 'Medium', 'Morning', true)
on conflict (slug) do nothing;
