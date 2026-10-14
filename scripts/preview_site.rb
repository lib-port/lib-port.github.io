# frozen_string_literal: true

require "jekyll"
require "octokit"

# Keep recovery local to preview.sh; production builds use Jekyll directly.
module PreviewBuildRecovery
  MAX_ATTEMPTS = 3

  def build(site, options)
    attempts = 0
    begin
      attempts += 1
      super
    rescue Octokit::ServerError
      if attempts < MAX_ATTEMPTS
        Jekyll.logger.warn "Preview:",
                           "GitHub returned a server error; retrying the build " \
                           "(#{attempts + 1}/#{MAX_ATTEMPTS})."
        sleep attempts
        retry
      end

      destination = File.expand_path(options.fetch("destination"))
      index = File.join(destination, "index.html")
      unless File.file?(index) && File.readable?(index) && File.size?(index)
        Jekyll.logger.error "Preview:",
                            "GitHub is unavailable and no previous build exists in #{destination}. " \
                            "Try ./preview.sh again when GitHub recovers."
        raise
      end

      Jekyll.logger.warn "Preview:",
                         "GitHub is unavailable; serving the existing build in #{destination}. " \
                         "It may not include recent edits. Restart ./preview.sh to retry the build."
    end
  end
end

if $PROGRAM_NAME == __FILE__
  Jekyll::Commands::Build.singleton_class.prepend(PreviewBuildRecovery)
  load Gem.bin_path("jekyll", "jekyll")
end
