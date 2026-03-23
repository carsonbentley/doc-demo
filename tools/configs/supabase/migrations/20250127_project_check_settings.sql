-- Create project_check_settings table for customizable rules per project
-- This allows each project to enable/disable specific checks without modifying the requirements table

CREATE TABLE IF NOT EXISTS project_check_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    requirement_id UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one setting per project-requirement combination
    UNIQUE(project_id, requirement_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_project_check_settings_project_id ON project_check_settings(project_id);
CREATE INDEX IF NOT EXISTS idx_project_check_settings_requirement_id ON project_check_settings(requirement_id);
CREATE INDEX IF NOT EXISTS idx_project_check_settings_enabled ON project_check_settings(is_enabled);

-- Add RLS policies
ALTER TABLE project_check_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access settings for projects in their organization
CREATE POLICY "Users can access project check settings for their organization projects" ON project_check_settings
    FOR ALL USING (
        project_id IN (
            SELECT p.id FROM projects p
            JOIN users u ON u.organization_id = p.organization_id
            WHERE u.id = auth.uid()
        )
    );

-- Function to automatically create default settings for new projects
CREATE OR REPLACE FUNCTION create_default_project_check_settings()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert default settings for all active requirements
    INSERT INTO project_check_settings (project_id, requirement_id, is_enabled)
    SELECT NEW.id, r.id, r.is_active
    FROM requirements r
    WHERE r.is_active = true
    ON CONFLICT (project_id, requirement_id) DO NOTHING;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create default settings when a new project is created
CREATE TRIGGER trigger_create_default_project_check_settings
    AFTER INSERT ON projects
    FOR EACH ROW
    EXECUTE FUNCTION create_default_project_check_settings();

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_project_check_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update the updated_at timestamp
CREATE TRIGGER trigger_update_project_check_settings_updated_at
    BEFORE UPDATE ON project_check_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_project_check_settings_updated_at();

-- Add comment explaining the table purpose
COMMENT ON TABLE project_check_settings IS 'Stores project-specific settings for enabling/disabling individual requirement checks. Each project can customize which checks are enabled without modifying the global requirements table.';
COMMENT ON COLUMN project_check_settings.is_enabled IS 'Whether this specific check is enabled for this project. Defaults to true (enabled).';
