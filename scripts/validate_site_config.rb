#!/usr/bin/env ruby
# frozen_string_literal: true

require_relative "site_config"

begin
  raise LibPort::SiteConfig::ValidationError, "Usage: #{$PROGRAM_NAME} [CONFIG_PATH]" if ARGV.length > 1

  LibPort::SiteConfig.validate_file(ARGV.first || LibPort::SiteConfig::CONFIG_PATH)
  puts "Validated site configuration"
rescue LibPort::SiteConfig::ValidationError => error
  warn "Failed to validate site configuration: #{error.message}"
  exit 1
end
