# frozen_string_literal: true

Jekyll::Hooks.register :site, :after_init do |site|
  next if site.config.dig("paper_plane", "switch") == true

  site.exclude.concat(["assets/js/title_flight.js"]).uniq!
end
