-- Encrypt Google OAuth tokens at rest using pgcrypto
-- This is a critical security improvement to protect user tokens

-- Enable pgcrypto extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add new encrypted columns
ALTER TABLE IF EXISTS public.google_tokens 
ADD COLUMN IF NOT EXISTS access_token_encrypted BYTEA,
ADD COLUMN IF NOT EXISTS refresh_token_encrypted BYTEA;

-- Add comment explaining the encryption
COMMENT ON COLUMN public.google_tokens.access_token_encrypted IS 
'Encrypted access token using pgcrypto. Use pgp_sym_decrypt to read.';

COMMENT ON COLUMN public.google_tokens.refresh_token_encrypted IS 
'Encrypted refresh token using pgcrypto. Use pgp_sym_decrypt to read.';

-- Note: The actual encryption/decryption will be handled in the application layer
-- using the GOOGLE_TOKEN_ENCRYPTION_KEY environment variable.
-- 
-- To encrypt: pgp_sym_encrypt(token, encryption_key)
-- To decrypt: pgp_sym_decrypt(encrypted_token, encryption_key)
--
-- Migration strategy:
-- 1. Add encrypted columns (done above)
-- 2. Application code should:
--    a. Read from access_token (plain) if access_token_encrypted is NULL
--    b. Write to both access_token and access_token_encrypted during transition
--    c. After all tokens are encrypted, drop plain text columns
-- 3. For now, keep both columns for backward compatibility

-- Add index for faster token lookups (on user_id, which is already indexed)
-- The encrypted columns don't need indexes as they're not searchable

-- Security note: Make sure to:
-- 1. Set GOOGLE_TOKEN_ENCRYPTION_KEY in environment variables
-- 2. Use a strong, randomly generated key (at least 32 characters)
-- 3. Store the key securely (e.g., in a secrets manager)
-- 4. Rotate the key periodically and re-encrypt all tokens

