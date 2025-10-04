module Jekyll
  module ObsidianConverter
    # Convert Obsidian wikilinks to Jekyll markdown
    def convert_obsidian_syntax(content)
      # Convert Obsidian callouts first (before other conversions)
      content = convert_callouts(content)

      # Convert Obsidian highlights: ==text== -> <mark>text</mark>
      content = content.gsub(/==([^=]+)==/) do |match|
        "<mark>#{$1}</mark>"
      end

      # Convert image wikilinks: ![[image.png]] -> ![image](/assets/images/posts/image.png)
      content = content.gsub(/!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|svg|webp))\]\]/i) do |match|
        image_name = $1
        alt_text = File.basename(image_name, '.*')
        "![#{alt_text}](/assets/images/posts/#{image_name})"
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

          # Build the callout HTML
          body_html = callout_body.join("\n").strip
          result << "<div class=\"callout callout-#{type}\">"
          result << "  <div class=\"callout-title\">#{title}</div>"
          result << "  <div class=\"callout-content\">#{body_html}</div>"
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
