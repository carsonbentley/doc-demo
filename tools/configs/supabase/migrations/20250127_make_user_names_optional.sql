-- Make first_name and last_name optional in users table
-- This allows users to sign up with just email through Supabase Auth

-- Make first_name and last_name nullable
ALTER TABLE public.users 
ALTER COLUMN first_name DROP NOT NULL,
ALTER COLUMN last_name DROP NOT NULL;

-- Set default values for existing users who might have empty strings
UPDATE public.users 
SET first_name = NULL 
WHERE first_name = '';

UPDATE public.users 
SET last_name = NULL 
WHERE last_name = '';

-- Add a comment to document the change
COMMENT ON COLUMN public.users.first_name IS 'Optional first name - can be null for users who sign up with just email';
COMMENT ON COLUMN public.users.last_name IS 'Optional last name - can be null for users who sign up with just email';
