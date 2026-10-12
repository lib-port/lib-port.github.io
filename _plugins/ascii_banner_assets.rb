# frozen_string_literal: true

Jekyll::Hooks.register :site, :after_init do |site|
  next if site.config.dig("ascii-banner", "switch") == true

  site.exclude.concat([
    "assets/js/ascii_banner.mjs",
    "assets/js/ascii-rest/",
  ]).uniq!
end
