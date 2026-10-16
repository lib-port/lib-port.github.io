# frozen_string_literal: true

require_relative "../../scripts/site_config"
$stdout.sync = true

STDIN.each_line do |line|
  request = JSON.parse(line)
  options = { source_root: request.fetch("source_root", LibPort::SiteConfig::ROOT) }
  begin
    result = if request.key?("raw")
               LibPort::SiteConfig.validate_hash(request["raw"], **options, config_path: request.fetch("config_path", "fixture"))
             else
               LibPort::SiteConfig.validate_file(request.fetch("config_path"), **options)
             end
    puts JSON.generate(result: result, raw: request["raw"])
  rescue LibPort::SiteConfig::ValidationError => error
    puts JSON.generate(error: error.message)
  end
end
