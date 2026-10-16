# frozen_string_literal: true

require "yaml"
require "json"
require "date"
require "uri"
require "addressable/uri"

module LibPort
  module SiteConfig
    ROOT = File.expand_path("..", __dir__)
    CONFIG_PATH = File.join(ROOT, "_config.yml")
    class ValidationError < StandardError; end

    module_function

    def validate_file(path = CONFIG_PATH, source_root: ROOT)
      begin
        raw = YAML.safe_load(File.read(path, encoding: "utf-8"), permitted_classes: [Date, Time], aliases: true)
      rescue Psych::Exception => error
        raise ValidationError, "Malformed YAML in #{path}: #{error.message}"
      rescue SystemCallError, IOError => error
        raise ValidationError, "Failed to read #{path}: #{error.message}"
      end
      validate_hash(raw.nil? ? {} : raw, config_path: path, source_root: source_root)
    end

    # Return normalised settings without changing Jekyll's configuration or its order.
    def validate_hash(raw, config_path: CONFIG_PATH, source_root: ROOT)
      raise ValidationError, "#{config_path} must contain a top-level mapping" unless raw.is_a?(Hash)

      result = {}
      # Preserve the diagnostic order of the original validator.
      names = %w[recent_milestones repo_grid find_the_bug_game light_dark_ball github_icon paper_plane intro ascii_banner recent_commits external_blog]
      names.each do |name|
        section = raw[name]
        section = {} if section.nil?
        raise ValidationError, "#{config_path}: #{name} must be a mapping" unless section.is_a?(Hash)

        switch = section["switch"]
        unless [true, false, nil].include?(switch)
          raise ValidationError, "#{config_path}: #{name}.switch must be a YAML boolean"
        end
        enabled = switch == true
        settings = { "enabled" => enabled }
        case name
        when "github_icon"
          settings["link"] = enabled ? choice(section, name, "link", %w[profile repos], config_path) : ""
          settings["style"] = enabled ? choice(section, name, "style", %w[auto text icon], config_path, default: "text") : ""
        when "intro"
          settings["text"] = enabled ? required_string(section, name, "text", config_path) : ""
        when "ascii_banner"
          settings["module"] = enabled ? scene(section, config_path, source_root) : ""
        when "repo_grid", "recent_milestones"
          if name == "recent_milestones"
            settings["milestones"] = enabled ? limit(section, name, "milestones", config_path) : 0
          end
          settings["repo_list"] = enabled ? repositories(section, name, config_path) : []
        when "recent_commits"
          settings["commits"] = enabled ? limit(section, name, "commits", config_path) : 0
        when "external_blog"
          %w[feed_url archive_url].each do |key|
            settings[key] = enabled ? http_url(section, name, key, config_path) : ""
          end
          settings["post_limit"] = enabled ? limit(section, name, "post_limit", config_path) : 0
        end
        result[name] = settings
      end
      result
    end

    def choice(section, name, key, values, path, default: nil)
      value = section.fetch(key, default)
      return value if values.include?(value)

      options = values.map { |option| "'#{option}'" }
      description = options.length == 2 ? options.join(" or ") : "#{options[0...-1].join(', ')}, or #{options.last}"
      raise ValidationError, "#{path}: #{name}.switch is true, but #{name}.#{key} must be exactly #{description}"
    end

    def limit(section, name, key, path)
      value = section[key]
      return value if value.is_a?(Integer) && (1..10).cover?(value)

      raise ValidationError, "#{path}: #{name}.switch is true, but #{name}.#{key} must be an integer between 1 and 10"
    end

    def trim(value)
      value.gsub(/\A[[:space:]]+|[[:space:]]+\z/, "")
    end

    def required_string(section, name, key, path)
      value = section[key]
      unless value.nil? || value.is_a?(String)
        raise ValidationError, "#{path}: #{name}.#{key} must be a string"
      end
      value = value.nil? ? "" : trim(value)
      if value.empty?
        raise ValidationError, "#{path}: #{name}.switch is true, but #{name}.#{key} is missing or blank"
      end
      value
    end

    def repositories(section, name, path)
      list = section["repo_list"]
      unless list.is_a?(Array) && !list.empty?
        raise ValidationError, "#{path}: #{name}.switch is true, but #{name}.repo_list must be a non-empty list of repository names"
      end
      seen = {}
      duplicates = {}
      normalised = list.each_with_index.map do |item, index|
        unless item.is_a?(String) && !trim(item).empty?
          raise ValidationError, "#{path}: #{name}.repo_list[#{index}] must be a non-blank string"
        end
        value = trim(item)
        key = value.downcase(:fold)
        duplicates[key] ||= value if seen[key]
        seen[key] = true
        value
      end
      unless duplicates.empty?
        raise ValidationError, "#{path}: #{name}.repo_list contains duplicate repository names: #{duplicates.values.join(', ')}"
      end
      normalised
    end

    def http_url(section, name, key, path)
      value = required_string(section, name, key, path)
      begin
        uri = Addressable::URI.parse(value)
        URI.parse("http://#{uri.host}") if uri.host&.match?(/[\[\]]/)
        return value if %w[http https].include?(uri.scheme&.downcase) && uri.host && !uri.host.empty?
      rescue Addressable::URI::InvalidURIError, URI::InvalidURIError, ArgumentError
        # Report all invalid URLs using the same configuration diagnostic.
      end
      raise ValidationError, "#{path}: #{name}.#{key} must be an absolute HTTP(S) URL"
    end

    def scene(section, path, source_root)
      name = required_string(section, "ascii_banner", "module", path)
      catalogue = File.join(source_root, "assets/js/ascii-rest/manifest.json")
      begin
        manifest = JSON.parse(File.read(catalogue, encoding: "utf-8"))
        raise TypeError, "catalogue must be a mapping" unless manifest.is_a?(Hash)

        scenes = manifest.fetch("scenes")
        raise TypeError, "scenes must be a list of names" unless scenes.is_a?(Array) && scenes.all? { |entry| entry.is_a?(String) }
      rescue SystemCallError, IOError, JSON::ParserError, KeyError, TypeError => error
        raise ValidationError, "#{path}: cannot read the local ASCII scene catalogue: #{error.message}"
      end
      available = ->(entry) { File.file?(File.join(File.dirname(catalogue), "pieces", "#{entry}.js")) }
      if name == "random"
        unless !scenes.empty? && scenes.all?(&available)
          raise ValidationError, "#{path}: ascii_banner.module 'random' requires a non-empty catalogue of locally available scenes"
        end
      elsif !scenes.include?(name) || !available.call(name)
        raise ValidationError, "#{path}: ascii_banner.module must name a locally available scene; choose 'random' or one of: #{scenes.join(', ')}"
      end
      name
    end
  end
end
