-- Extra roles the same account holds beyond its primary one. Staff who are also
-- parents cannot be split into two accounts: sign-in is tied 1:1 to a Firebase
-- email, so a second account would be refused as "already signs in as".
-- Empty array default: every existing row keeps exactly the role it had.
ALTER TABLE "users" ADD COLUMN "secondary_roles" "user_role"[] NOT NULL DEFAULT ARRAY[]::"user_role"[];
