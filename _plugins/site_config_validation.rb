# frozen_string_literal: true

require_relative "../scripts/site_config"

# Validate merged settings before asset hooks inspect them, including on rebuilds.
[:after_init, :after_reset].each do |event|
  Jekyll::Hooks.register :site, event, priority: :high do |site|
    LibPort::SiteConfig.validate_hash(site.config, source_root: site.source,
                                    config_path: site.config["config"] || "Jekyll configuration")
  rescue LibPort::SiteConfig::ValidationError => error
    raise Jekyll::Errors::FatalException, "Failed to validate site configuration: #{error.message}"
  end
end
