-- Drop the trigger that's causing the error when creating organizations
DROP TRIGGER IF EXISTS trigger_create_default_project_check_settings ON public.organizations;

-- Drop the function that the trigger was calling
DROP FUNCTION IF EXISTS create_default_project_check_settings();

-- Drop tables related to the old requirements system since they're no longer needed
DROP TABLE IF EXISTS public.project_check_settings CASCADE;
DROP TABLE IF EXISTS public.project_disabled_checks CASCADE;
DROP TABLE IF EXISTS public.requirement_results CASCADE;
DROP TABLE IF EXISTS public.requirements CASCADE;
