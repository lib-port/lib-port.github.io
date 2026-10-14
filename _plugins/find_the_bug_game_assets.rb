# frozen_string_literal: true

Jekyll::Hooks.register :site, :after_init do |site|
  next if site.config.dig("find_the_bug_game", "switch") == true

  site.exclude.concat(["assets/js/drag_reveal.js"]).uniq!
end
