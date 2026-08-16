-- v1.10.1 F5: formalize team_members.role into a fixed set —
-- Admin, Stocker, Receiver, Sales, Account Manager — and set Brian's
-- record to Admin. The Team tab's Role dropdown now only offers these
-- five values; this migration cleans up any existing free-text rows
-- (the old form allowed "Owner") to match.

-- Old "Owner" rows become Admin under the new fixed set.
UPDATE team_members SET role = 'Admin' WHERE role = 'Owner';

-- Brian — matched by Cloudflare Access login email.
UPDATE team_members SET role = 'Admin' WHERE email = 'brian.morris298@gmail.com';

-- Vala — replace the email below with her actual Cloudflare Access login
-- email, then uncomment and run this line separately (left commented out
-- since her exact login email wasn't available to fill in automatically):
-- UPDATE team_members SET role = 'Admin' WHERE email = 'vala@example.com';

-- Any other existing row with a role outside the new fixed set
-- (shouldn't happen via the UI, but covers rows entered before this
-- migration some other way) falls back to Stocker rather than being left
-- in a state nothing recognizes.
UPDATE team_members
SET role = 'Stocker'
WHERE role NOT IN ('Admin', 'Stocker', 'Receiver', 'Sales', 'Account Manager');
