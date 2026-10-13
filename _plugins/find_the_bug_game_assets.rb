# frozen_string_literal: true

Jekyll::Hooks.register :site, :after_init do |site|
  game_enabled = site.config.dig("find_the_bug_game", "switch") == true
  ball_enabled = site.config.dig("light_dark_ball", "switch") == true
  site.exclude << "assets/js/drag_reveal.js" unless game_enabled
  site.exclude << "assets/js/light_dark_ball.js" unless ball_enabled
  site.exclude << "assets/js/drag_surface.js" unless game_enabled || ball_enabled
  site.exclude.uniq!
end
