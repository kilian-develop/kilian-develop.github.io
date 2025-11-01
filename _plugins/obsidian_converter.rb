module Jekyll
  module ObsidianConverter
    # Convert Obsidian wikilinks to Jekyll markdown
    def convert_obsidian_syntax(content)
      return content unless content.is_a?(String)

      # Convert Obsidian callouts first (before other conversions)
      content = convert_callouts(content)

      # Convert Obsidian highlights: ==text== -> <mark>text</mark>
      content = content.gsub(/==([^=]+)==/) do |match|
        "<mark>#{$1}</mark>"
      end

      # Convert image wikilinks with optional size and alignment
      # ![[image.png]] -> ![image](/assets/images/posts/image.png)
      # ![[image.png|300]] -> ![image](/assets/images/posts/image.png){: width="300px"}
      # ![[image.png|300|center]] -> ![image](/assets/images/posts/image.png){: width="300px" style="display: block; margin: 0 auto;"}
      content = content.gsub(/!\[\[([^\]|]+\.(?:png|jpg|jpeg|gif|svg|webp))(?:\|(\d+))?(?:\|(center|left|right))?\]\]/i) do |match|
        image_name = $1
        width = $2
        alignment = $3
        alt_text = File.basename(image_name, '.*')

        attributes = ""
        if width
          attributes += "width=\"#{width}px\""
        end

        if alignment
          if alignment.downcase == "center"
            style = "display: block; margin: 0 auto;"
          elsif alignment.downcase == "left"
            style = "float: left; margin-right: 1em;"
          elsif alignment.downcase == "right"
            style = "float: right; margin-left: 1em;"
          end
          attributes += " style=\"#{style}\"" if style
        end

        if attributes.empty?
          "![#{alt_text}](/assets/images/posts/#{image_name})"
        else
          "![#{alt_text}](/assets/images/posts/#{image_name}){: #{attributes}}"
        end
      end

      # Convert regular wikilinks: [[link]] -> [link](link)
      content = content.gsub(/\[\[([^\]|]+)\|?([^\]]*)\]\]/) do |match|
        link = $1
        text = $2.empty? ? $1 : $2
        "[#{text}](#{link})"
      end

      content
    end

    def convert_callouts(content)
      # Split content into lines for easier processing
      lines = content.split("\n")
      result = []
      i = 0

      while i < lines.length
        line = lines[i]

        # Check if this line starts a callout
        if line =~ /^>\s*\[!(\w+)\]\s*(.*)$/
          type = $1.downcase
          title = $2.strip
          title = type.capitalize if title.empty?

          # Collect all following lines that are part of the callout
          callout_body = []
          i += 1

          while i < lines.length && lines[i] =~ /^>\s?(.*)$/
            callout_body << $1
            i += 1
          end

          # Build the callout - convert markdown in content before wrapping
          body_content = callout_body.join("\n").strip

          # Convert markdown links directly: [text](url) -> <a href="url">text</a>
          body_html = body_content.gsub(/\[([^\]]+)\]\(([^)]+)\)/, '<a href="\2">\1</a>')
          # Convert bold: **text** -> <strong>text</strong>
          body_html = body_html.gsub(/\*\*([^\*]+)\*\*/, '<strong>\1</strong>')

          result << "<div class=\"callout callout-#{type}\">"
          result << "<div class=\"callout-title\">#{title}</div>"
          result << "<div class=\"callout-content\">"
          result << body_html
          result << "</div>"
          result << "</div>"
          result << ""
        else
          result << line
          i += 1
        end
      end

      result.join("\n")
    end
  end
end

# Hook to process content before rendering
Jekyll::Hooks.register [:posts, :pages], :pre_render do |item|
  if item.content
    converter = Class.new { include Jekyll::ObsidianConverter }.new
    item.content = converter.convert_obsidian_syntax(item.content)
  end
end

# Liquid filter to clean Obsidian syntax from excerpts
module Jekyll
  module ObsidianFilter
    def clean_obsidian_excerpt(input)
      return input unless input.is_a?(String)

      # Remove image wikilinks completely from excerpts
      content = input.gsub(/!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|svg|webp))\]\]/i, '')

      # Remove highlights but keep the text: ==text== -> text
      content = content.gsub(/==([^=]+)==/, '\1')

      # Remove regular wikilinks: [[link|text]] -> text or [[link]] -> link
      content = content.gsub(/\[\[([^\]|]+)\|?([^\]]*)\]\]/) do |match|
        $2.empty? ? $1 : $2
      end

      # Remove callouts
      content = content.gsub(/^>\s*\[!(\w+)\]\s*.*$/, '')
      content = content.gsub(/^>\s?(.*)$/, '\1')

      content
    end
  end
end

Liquid::Template.register_filter(Jekyll::ObsidianFilter)
