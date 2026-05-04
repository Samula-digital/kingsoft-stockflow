<?php
/**
 * Plugin Name: Bamutebi Elementor Bridge
 * Description: Recreates the Bamutebi Property Managers site inside WordPress as native Elementor pages with editable sections.
 * Version: 2.1.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

const BAMUTEBI_SOURCE_ROOT = __DIR__ . '/source';
const BAMUTEBI_ASSETS_ROOT = __DIR__ . '/assets';
const BAMUTEBI_PAGE_META_KEY = '_bamutebi_source_slug';
const BAMUTEBI_SYNC_OPTION = 'bamutebi_bridge_version';
const BAMUTEBI_SETTINGS_OPTION = 'bamutebi_site_settings';
const BAMUTEBI_IMAGE_OVERRIDES_OPTION = 'bamutebi_image_overrides';
const BAMUTEBI_BRIDGE_VERSION = '2.1.0';

function bamutebi_default_settings(): array
{
    return [
        'primary_phone_display' => '+256 763 556236',
        'primary_phone_link' => '+256763556236',
        'alt_phone_display' => '+256 705 882908',
        'alt_phone_link' => '+256705882908',
        'email' => 'info@bamutebipropertymanagers.com',
        'location' => 'Kyengera, Uganda',
        'whatsapp_link' => '256705882908',
        'whatsapp_message' => 'Hello Bamutebi Property Managers, I would like to make an enquiry.',
    ];
}

function bamutebi_get_settings(): array
{
    $saved = get_option(BAMUTEBI_SETTINGS_OPTION, []);
    if (!is_array($saved)) {
        $saved = [];
    }

    return array_merge(bamutebi_default_settings(), $saved);
}

function bamutebi_ensure_settings_defaults(): void
{
    if (get_option(BAMUTEBI_SETTINGS_OPTION, null) === null) {
        update_option(BAMUTEBI_SETTINGS_OPTION, bamutebi_default_settings());
    }

    if (get_option(BAMUTEBI_IMAGE_OVERRIDES_OPTION, null) === null) {
        update_option(BAMUTEBI_IMAGE_OVERRIDES_OPTION, []);
    }
}

function bamutebi_whatsapp_url(): string
{
    $settings = bamutebi_get_settings();

    return 'https://wa.me/' . rawurlencode($settings['whatsapp_link']) . '?text=' . rawurlencode($settings['whatsapp_message']);
}

function bamutebi_image_overrides(): array
{
    $saved = get_option(BAMUTEBI_IMAGE_OVERRIDES_OPTION, []);
    return is_array($saved) ? $saved : [];
}

function bamutebi_page_map(): array
{
    return [
        'home' => [
            'file' => 'index.html',
            'title' => 'Home',
            'path' => '/',
        ],
        'about' => [
            'file' => 'about.html',
            'title' => 'About',
            'path' => '/about/',
        ],
        'services' => [
            'file' => 'services.html',
            'title' => 'Services',
            'path' => '/services/',
        ],
        'faq' => [
            'file' => 'faq.html',
            'title' => 'FAQ',
            'path' => '/faq/',
        ],
        'testimonials' => [
            'file' => 'testimonials.html',
            'title' => 'Testimonials',
            'path' => '/testimonials/',
        ],
        'contact' => [
            'file' => 'contact.html',
            'title' => 'Contact',
            'path' => '/contact/',
        ],
    ];
}

function bamutebi_asset_url(string $path = ''): string
{
    return plugins_url('assets/' . ltrim($path, '/'), __FILE__);
}

function bamutebi_asset_relative_paths(): array
{
    $paths = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(BAMUTEBI_ASSETS_ROOT, FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterator as $file) {
        if (!$file instanceof SplFileInfo || !$file->isFile()) {
            continue;
        }

        $extension = strtolower($file->getExtension());
        if (!in_array($extension, ['jpg', 'jpeg', 'png', 'webp', 'svg'], true)) {
            continue;
        }

        $absolute = $file->getPathname();
        $relative = ltrim(str_replace(BAMUTEBI_ASSETS_ROOT, '', $absolute), DIRECTORY_SEPARATOR);
        $relative = str_replace(DIRECTORY_SEPARATOR, '/', $relative);
        $paths[] = $relative;
    }

    sort($paths);
    return array_values(array_unique($paths));
}

function bamutebi_media_attachment_id_for_asset(string $asset_relative_path): int
{
    $existing = get_posts([
        'post_type' => 'attachment',
        'post_status' => 'inherit',
        'posts_per_page' => 1,
        'fields' => 'ids',
        'meta_key' => '_bamutebi_asset_path',
        'meta_value' => $asset_relative_path,
    ]);

    if (!empty($existing[0])) {
        return (int) $existing[0];
    }

    $source_path = trailingslashit(BAMUTEBI_ASSETS_ROOT) . ltrim($asset_relative_path, '/');
    if (!is_readable($source_path)) {
        return 0;
    }

    $uploads = wp_upload_dir();
    if (!empty($uploads['error'])) {
        return 0;
    }

    $filename = 'bamutebi-' . basename($asset_relative_path);
    $destination = trailingslashit($uploads['path']) . wp_unique_filename($uploads['path'], $filename);

    if (!copy($source_path, $destination)) {
        return 0;
    }

    $mime_type = wp_check_filetype($destination)['type'] ?? 'application/octet-stream';

    $attachment_id = wp_insert_attachment([
        'post_mime_type' => $mime_type,
        'post_title' => preg_replace('/\.[^.]+$/', '', basename($destination)),
        'post_content' => '',
        'post_status' => 'inherit',
    ], $destination);

    if (is_wp_error($attachment_id) || !$attachment_id) {
        return 0;
    }

    require_once ABSPATH . 'wp-admin/includes/image.php';

    $metadata = wp_generate_attachment_metadata($attachment_id, $destination);
    if (!is_wp_error($metadata) && !empty($metadata)) {
        wp_update_attachment_metadata($attachment_id, $metadata);
    }

    update_post_meta($attachment_id, '_bamutebi_asset_path', $asset_relative_path);

    return (int) $attachment_id;
}

function bamutebi_default_media_url_for_asset(string $asset_relative_path): ?string
{
    $attachment_id = bamutebi_media_attachment_id_for_asset($asset_relative_path);
    if ($attachment_id <= 0) {
        return null;
    }

    $url = wp_get_attachment_url($attachment_id);
    return is_string($url) && $url !== '' ? $url : null;
}

function bamutebi_import_media_assets(): void
{
    foreach (bamutebi_asset_relative_paths() as $relative_path) {
        bamutebi_media_attachment_id_for_asset($relative_path);
    }
}

function bamutebi_media_url_for_asset(string $asset_relative_path): ?string
{
    $overrides = bamutebi_image_overrides();
    $override_id = isset($overrides[$asset_relative_path]) ? (int) $overrides[$asset_relative_path] : 0;
    $attachment_id = $override_id > 0 ? $override_id : bamutebi_media_attachment_id_for_asset($asset_relative_path);
    if ($attachment_id <= 0) {
        return null;
    }

    $url = wp_get_attachment_url($attachment_id);
    return is_string($url) && $url !== '' ? $url : null;
}

function bamutebi_attachment_id_from_src(string $src): int
{
    if ($src === '') {
        return 0;
    }

    $normalized = html_entity_decode($src, ENT_QUOTES);

    if (str_starts_with($normalized, 'assets/')) {
        return bamutebi_media_attachment_id_for_asset(substr($normalized, strlen('assets/')));
    }

    $plugin_base = bamutebi_asset_url();
    if (str_starts_with($normalized, $plugin_base)) {
        $relative = ltrim(substr($normalized, strlen($plugin_base)), '/');
        return bamutebi_media_attachment_id_for_asset($relative);
    }

    $attachment_id = attachment_url_to_postid($normalized);
    return $attachment_id > 0 ? (int) $attachment_id : 0;
}

function bamutebi_contact_replacements(): array
{
    $settings = bamutebi_get_settings();
    $whatsapp_url = bamutebi_whatsapp_url();

    return [
        'tel:+256763556236' => 'tel:' . $settings['primary_phone_link'],
        'tel:+256705882908' => 'tel:' . $settings['alt_phone_link'],
        '0763 556236' => $settings['primary_phone_display'],
        '+256 763 556236' => $settings['primary_phone_display'],
        '0705 882908' => $settings['alt_phone_display'],
        '+256 705 882908' => $settings['alt_phone_display'],
        'mailto:info@bamutebipropertymanagers.com' => 'mailto:' . $settings['email'],
        'info@bamutebipropertymanagers.com' => $settings['email'],
        'Kyengera, Uganda' => $settings['location'],
        'https://wa.me/256763556236?text=Hello%20Bamutebi%20Property%20Managers%2C%20I%20would%20like%20to%20make%20an%20enquiry.' => $whatsapp_url,
        'https://wa.me/256705882908?text=Hello%20Bamutebi%20Property%20Managers%2C%20I%20would%20like%20to%20make%20an%20enquiry.' => $whatsapp_url,
    ];
}

function bamutebi_current_page_slug(): ?string
{
    if (!is_singular('page')) {
        return null;
    }

    $post_id = get_queried_object_id();
    if (!$post_id) {
        return null;
    }

    $slug = get_post_meta($post_id, BAMUTEBI_PAGE_META_KEY, true);
    return is_string($slug) && $slug !== '' ? $slug : null;
}

function bamutebi_source_path(string $slug): ?string
{
    $map = bamutebi_page_map();
    if (!isset($map[$slug])) {
        return null;
    }

    $path = trailingslashit(BAMUTEBI_SOURCE_ROOT) . $map[$slug]['file'];
    return is_readable($path) ? $path : null;
}

function bamutebi_read_source(string $slug): ?string
{
    $path = bamutebi_source_path($slug);
    if ($path === null) {
        return null;
    }

    $html = file_get_contents($path);
    return is_string($html) ? $html : null;
}

function bamutebi_extract_body_markup(string $html): string
{
    if (preg_match('~<body[^>]*>(.*?)(?:<script\s+src="assets/js/main\.js"></script>\s*)</body>~is', $html, $match) === 1) {
        return trim($match[1]);
    }

    if (preg_match('~<body[^>]*>(.*)</body>~is', $html, $match) === 1) {
        return trim($match[1]);
    }

    return $html;
}

function bamutebi_extract_head_markup(string $html): string
{
    if (preg_match('~<head[^>]*>(.*)</head>~is', $html, $match) === 1) {
        return trim($match[1]);
    }

    return '';
}

function bamutebi_internal_page_urls(): array
{
    return [
        'index.html' => home_url('/'),
        'about.html' => home_url('/about/'),
        'services.html' => home_url('/services/'),
        'faq.html' => home_url('/faq/'),
        'testimonials.html' => home_url('/testimonials/'),
        'contact.html' => home_url('/contact/'),
    ];
}

function bamutebi_transform_markup(string $markup): string
{
    $replacements = bamutebi_internal_page_urls();

    foreach (bamutebi_asset_relative_paths() as $asset_relative_path) {
        $media_url = bamutebi_media_url_for_asset($asset_relative_path);
        if ($media_url === null) {
            continue;
        }

        $replacements['assets/' . $asset_relative_path] = $media_url;
    }

    $replacements['assets/'] = bamutebi_asset_url();
    $replacements = array_merge($replacements, bamutebi_contact_replacements());

    return str_replace(array_keys($replacements), array_values($replacements), $markup);
}

function bamutebi_source_body_classes(string $slug): array
{
    $source = bamutebi_read_source($slug);
    if ($source === null) {
        return [];
    }

    if (preg_match('~<body[^>]*class="([^"]+)"~i', $source, $match) !== 1) {
        return [];
    }

    $classes = preg_split('/\s+/', trim($match[1])) ?: [];
    return array_values(array_filter(array_map('sanitize_html_class', $classes)));
}

function bamutebi_capture_node_html(DOMNode $node): string
{
    $document = $node->ownerDocument;
    if (!$document instanceof DOMDocument) {
        return '';
    }

    return trim($document->saveHTML($node));
}


function bamutebi_slugify_chunk_label(string $label): string
{
    $slug = sanitize_title($label);
    return $slug !== '' ? $slug : 'section';
}

function bamutebi_chunk_name(DOMElement $element, int $index): string
{
    $tag = strtolower($element->tagName);
    $class = trim((string) $element->getAttribute('class'));
    $first_class = $class !== '' ? preg_split('/\s+/', $class)[0] : '';

    if ($first_class !== '') {
        return bamutebi_slugify_chunk_label($first_class);
    }

    return $tag . '-' . ($index + 1);
}

function bamutebi_source_chunks(string $slug): array
{
    $source = bamutebi_read_source($slug);
    if ($source === null) {
        return [];
    }

    $body = bamutebi_extract_body_markup($source);
    if ($body === '') {
        return [];
    }

    libxml_use_internal_errors(true);

    $document = new DOMDocument();
    $wrapped = '<!DOCTYPE html><html><body><div id="bamutebi-root">' . $body . '</div></body></html>';
    $document->loadHTML(mb_convert_encoding($wrapped, 'HTML-ENTITIES', 'UTF-8'));

    libxml_clear_errors();

    $root = $document->getElementById('bamutebi-root');
    if (!$root instanceof DOMElement) {
        return [];
    }

    $chunks = [];
    $top_index = 0;

    foreach ($root->childNodes as $node) {
        if (!$node instanceof DOMElement) {
            continue;
        }

        if (strtolower($node->tagName) === 'script') {
            continue;
        }

        if (strtolower($node->tagName) === 'main') {
            $section_index = 0;
            foreach ($node->childNodes as $main_child) {
                if (!$main_child instanceof DOMElement) {
                    continue;
                }

                if (strtolower($main_child->tagName) === 'script') {
                    continue;
                }

                $html = bamutebi_capture_node_html($main_child);
                if ($html === '') {
                    continue;
                }

                if ($section_index === 0 && strpos($html, 'id="main-content"') === false) {
                    $html = preg_replace('/^<section\b/', '<section id="main-content"', $html, 1) ?? $html;
                }

                $chunks[] = [
                    'name' => 'main-' . bamutebi_chunk_name($main_child, $section_index),
                    'html' => bamutebi_transform_markup($html),
                ];
                $section_index++;
            }
            continue;
        }

        $html = bamutebi_capture_node_html($node);
        if ($html === '') {
            continue;
        }

        $chunks[] = [
            'name' => bamutebi_chunk_name($node, $top_index),
            'html' => bamutebi_transform_markup($html),
        ];
        $top_index++;
    }

    return $chunks;
}

function bamutebi_elementor_id(): string
{
    return str_replace('-', '', wp_generate_uuid4());
}

function bamutebi_elementor_html_widget(string $html, string $class = ''): array
{
    $settings = [
        'html' => $html,
    ];

    if ($class !== '') {
        $settings['_css_classes'] = $class;
    }

    return [
        'id' => bamutebi_elementor_id(),
        'elType' => 'widget',
        'widgetType' => 'html',
        'settings' => $settings,
        'elements' => [],
    ];
}

function bamutebi_elementor_image_widget(
    int $attachment_id,
    string $url,
    string $alt = '',
    string $class = '',
    string $caption = ''
): array {
    $settings = [
        'image' => [
            'id' => $attachment_id,
            'url' => $url,
        ],
        'image_size' => 'full',
        'caption_source' => 'none',
    ];

    if ($alt !== '') {
        $settings['image']['alt'] = $alt;
    }

    if ($caption !== '') {
        $settings['caption_source'] = 'custom';
        $settings['caption'] = $caption;
    }

    if ($class !== '') {
        $settings['_css_classes'] = $class;
    }

    return [
        'id' => bamutebi_elementor_id(),
        'elType' => 'widget',
        'widgetType' => 'image',
        'settings' => $settings,
        'elements' => [],
    ];
}

function bamutebi_try_image_strip_section(array $chunk): ?array
{
    $html = $chunk['html'] ?? '';
    if ($html === '' || strpos($html, 'image-strip') === false) {
        return null;
    }

    libxml_use_internal_errors(true);
    $document = new DOMDocument();
    $document->loadHTML(mb_convert_encoding('<!DOCTYPE html><html><body>' . $html . '</body></html>', 'HTML-ENTITIES', 'UTF-8'));
    libxml_clear_errors();

    $body = $document->getElementsByTagName('body')->item(0);
    if (!$body instanceof DOMElement) {
        return null;
    }

    $root = null;
    foreach ($body->childNodes as $child) {
        if ($child instanceof DOMElement) {
            $root = $child;
            break;
        }
    }

    if (!$root instanceof DOMElement) {
        return null;
    }

    $container = null;
    foreach ($root->childNodes as $child) {
        if (!$child instanceof DOMElement) {
            continue;
        }

        $classes = preg_split('/\s+/', trim((string) $child->getAttribute('class'))) ?: [];
        if (in_array('image-strip', $classes, true)) {
            $container = $child;
            break;
        }
    }

    if (!$container instanceof DOMElement) {
        return null;
    }

    $columns = [];
    foreach ($container->childNodes as $child) {
        if (!$child instanceof DOMElement || strtolower($child->tagName) !== 'figure') {
            continue;
        }

        $img = null;
        foreach ($child->childNodes as $grandchild) {
            if ($grandchild instanceof DOMElement && strtolower($grandchild->tagName) === 'img') {
                $img = $grandchild;
                break;
            }
        }

        if (!$img instanceof DOMElement) {
            continue;
        }

        $src = (string) $img->getAttribute('src');
        $attachment_id = bamutebi_attachment_id_from_src($src);
        if ($attachment_id <= 0) {
            continue;
        }

        $url = wp_get_attachment_url($attachment_id);
        if (!is_string($url) || $url === '') {
            continue;
        }

        $figure_classes = trim((string) $child->getAttribute('class'));
        $img_classes = trim((string) $img->getAttribute('class'));
        $widget_class = trim($figure_classes . ' ' . $img_classes);

        $columns[] = [
            'id' => bamutebi_elementor_id(),
            'elType' => 'column',
            'isInner' => false,
            'settings' => [
                '_column_size' => 33.33,
            ],
            'elements' => [
                bamutebi_elementor_image_widget(
                    $attachment_id,
                    $url,
                    (string) $img->getAttribute('alt'),
                    $widget_class
                ),
            ],
        ];
    }

    if (count($columns) < 1) {
        return null;
    }

    $chunk_slug = sanitize_html_class($chunk['name'] ?? 'section');

    return [
        'id' => bamutebi_elementor_id(),
        'elType' => 'section',
        'settings' => [
            'layout' => 'full_width',
            'content_width' => 'full',
            'gap' => 'default',
            '_css_classes' => 'bamutebi-elementor-chunk bamutebi-chunk-' . $chunk_slug,
        ],
        'elements' => $columns,
    ];
}

function bamutebi_elementor_section(array $chunk): array
{
    $image_section = bamutebi_try_image_strip_section($chunk);
    if (is_array($image_section)) {
        return $image_section;
    }

    $chunk_slug = sanitize_html_class($chunk['name'] ?? 'section');

    return [
        'id' => bamutebi_elementor_id(),
        'elType' => 'section',
        'settings' => [
            'layout' => 'full_width',
            'content_width' => 'full',
            'gap' => 'no',
            '_css_classes' => 'bamutebi-elementor-chunk bamutebi-chunk-' . $chunk_slug,
        ],
        'elements' => [
            [
                'id' => bamutebi_elementor_id(),
                'elType' => 'column',
                'isInner' => false,
                'settings' => [
                    '_column_size' => 100,
                ],
                'elements' => [
                    bamutebi_elementor_html_widget(
                        $chunk['html'] ?? '',
                        'bamutebi-html-widget bamutebi-html-' . $chunk_slug
                    ),
                ],
            ],
        ],
    ];
}

function bamutebi_elementor_data(string $slug): string
{
    $chunks = bamutebi_source_chunks($slug);
    $sections = array_map('bamutebi_elementor_section', $chunks);

    return wp_json_encode($sections, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function bamutebi_render_source_page(string $slug): string
{
    $source = bamutebi_read_source($slug);
    if ($source === null) {
        return '<div class="bamutebi-missing-page">Bamutebi source page not found.</div>';
    }

    $markup = bamutebi_extract_body_markup($source);
    $markup = bamutebi_transform_markup($markup);

    return '<div class="bamutebi-source-page bamutebi-source-page-' . esc_attr($slug) . '">' . $markup . '</div>';
}

function bamutebi_source_page_shortcode(array $atts): string
{
    $atts = shortcode_atts(
        [
            'slug' => '',
        ],
        $atts,
        'bamutebi_source_page'
    );

    $slug = sanitize_key((string) $atts['slug']);
    if ($slug === '') {
        return '';
    }

    return bamutebi_render_source_page($slug);
}
add_shortcode('bamutebi_source_page', 'bamutebi_source_page_shortcode');

function bamutebi_enqueue_assets(): void
{
    $slug = bamutebi_current_page_slug();
    if ($slug === null) {
        return;
    }

    wp_enqueue_style(
        'bamutebi-site-styles',
        bamutebi_asset_url('css/style.css'),
        [],
        (string) filemtime(BAMUTEBI_ASSETS_ROOT . '/css/style.css')
    );

    wp_enqueue_script(
        'bamutebi-site-app',
        bamutebi_asset_url('js/main.js'),
        [],
        (string) filemtime(BAMUTEBI_ASSETS_ROOT . '/js/main.js'),
        true
    );
}
add_action('wp_enqueue_scripts', 'bamutebi_enqueue_assets');

function bamutebi_cleanup_wordpress_frontend(): void
{
    if (bamutebi_current_page_slug() === null) {
        return;
    }

    wp_dequeue_style('sirro-starter-style');
    wp_dequeue_style('wp-block-library');
    wp_dequeue_style('classic-theme-styles');
    wp_dequeue_style('global-styles');

    remove_action('wp_head', 'rsd_link');
    remove_action('wp_head', 'wlwmanifest_link');
    remove_action('wp_head', 'wp_generator');
    remove_action('wp_head', 'rest_output_link_wp_head');
    remove_action('wp_head', 'wp_oembed_add_discovery_links');
}
add_action('wp_enqueue_scripts', 'bamutebi_cleanup_wordpress_frontend', 100);

function bamutebi_body_classes(array $classes): array
{
    $slug = bamutebi_current_page_slug();
    if ($slug === null) {
        return $classes;
    }

    return array_values(array_unique(array_merge(
        $classes,
        ['bamutebi-elementor-page'],
        bamutebi_source_body_classes($slug)
    )));
}
add_filter('body_class', 'bamutebi_body_classes');

function bamutebi_source_title(string $slug): ?string
{
    $source = bamutebi_read_source($slug);
    if ($source === null) {
        return null;
    }

    if (preg_match('~<title>(.*?)</title>~is', $source, $match) !== 1) {
        return null;
    }

    return html_entity_decode(trim(wp_strip_all_tags($match[1])), ENT_QUOTES);
}

function bamutebi_document_title(string $title): string
{
    $slug = bamutebi_current_page_slug();
    if ($slug === null) {
        return $title;
    }

    return bamutebi_source_title($slug) ?: $title;
}
add_filter('pre_get_document_title', 'bamutebi_document_title');

function bamutebi_head_markup(): void
{
    $slug = bamutebi_current_page_slug();
    if ($slug === null) {
        return;
    }

    $source = bamutebi_read_source($slug);
    if ($source === null) {
        return;
    }

    $head = bamutebi_extract_head_markup($source);
    if ($head === '') {
        return;
    }

    if (preg_match('~<meta name="description" content="([^"]*)"\s*/?>~i', $head, $meta) === 1) {
        echo '<meta name="description" content="' . esc_attr($meta[1]) . '">' . "\n";
    }

    if (preg_match('~<meta name="theme-color" content="([^"]*)"\s*/?>~i', $head, $theme_color) === 1) {
        echo '<meta name="theme-color" content="' . esc_attr($theme_color[1]) . '">' . "\n";
    }

    if (preg_match('~<link rel="icon" type="([^"]*)" href="([^"]*)"\s*/?>~i', $head, $icon) === 1) {
        echo '<link rel="icon" type="' . esc_attr($icon[1]) . '" href="' . esc_url(bamutebi_asset_url('logo/' . basename($icon[2]))) . '">' . "\n";
    }
}
add_action('wp_head', 'bamutebi_head_markup', 20);

function bamutebi_upsert_pages(): void
{
    bamutebi_import_media_assets();

    $map = bamutebi_page_map();
    $front_page_id = 0;

    foreach ($map as $slug => $config) {
        $existing = get_pages([
            'meta_key' => BAMUTEBI_PAGE_META_KEY,
            'meta_value' => $slug,
            'post_type' => 'page',
            'post_status' => ['publish', 'draft', 'private'],
            'number' => 1,
        ]);

        if (empty($existing)) {
            $slug_match = get_page_by_path($slug, OBJECT, 'page');
            if ($slug_match instanceof WP_Post) {
                $existing = [$slug_match];
            }
        }

        $page_data = [
            'post_title' => $config['title'],
            'post_name' => $slug,
            'post_type' => 'page',
            'post_status' => 'publish',
            'post_content' => '',
        ];

        if (!empty($existing)) {
            $page_data['ID'] = (int) $existing[0]->ID;
            $page_id = wp_update_post($page_data, true);
        } else {
            $page_id = wp_insert_post($page_data, true);
        }

        if (is_wp_error($page_id) || !$page_id) {
            continue;
        }

        $elementor_data = bamutebi_elementor_data($slug);

        update_post_meta($page_id, BAMUTEBI_PAGE_META_KEY, $slug);
        update_post_meta($page_id, '_wp_page_template', 'elementor_canvas');
        delete_post_meta($page_id, '_elementor_edit_mode');
        delete_post_meta($page_id, '_elementor_template_type');
        delete_post_meta($page_id, '_elementor_data');
        update_post_meta($page_id, '_elementor_edit_mode', 'builder');
        update_post_meta($page_id, '_elementor_template_type', 'wp-page');
        // WordPress unslashes post meta on save, so Elementor JSON must be slashed first.
        update_post_meta($page_id, '_elementor_data', wp_slash($elementor_data));

        if ($slug === 'home') {
            $front_page_id = (int) $page_id;
        }
    }

    if ($front_page_id > 0) {
        update_option('show_on_front', 'page');
        update_option('page_on_front', $front_page_id);
    }
}

function bamutebi_admin_menu(): void
{
    add_menu_page(
        'Bamutebi Site',
        'Bamutebi Site',
        'manage_options',
        'bamutebi-site',
        'bamutebi_render_admin_page',
        'dashicons-building',
        58
    );
}
add_action('admin_menu', 'bamutebi_admin_menu');

function bamutebi_admin_assets(string $hook): void
{
    if ($hook !== 'toplevel_page_bamutebi-site') {
        return;
    }

    wp_enqueue_media();
    wp_add_inline_style('common', '
        .bamutebi-admin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-top:20px}
        .bamutebi-card{background:#fff;border:1px solid #dcdcde;border-radius:14px;padding:20px;box-shadow:0 8px 30px rgba(11,31,58,.06)}
        .bamutebi-card h2{margin-top:0}
        .bamutebi-field{margin-bottom:16px}
        .bamutebi-field label{display:block;font-weight:600;margin-bottom:6px}
        .bamutebi-field input[type=text],.bamutebi-field input[type=email],.bamutebi-field textarea{width:100%}
        .bamutebi-media-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
        .bamutebi-media-item{border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#f8fafc}
        .bamutebi-media-item img{width:100%;height:140px;object-fit:cover;border-radius:10px;background:#fff;border:1px solid #e2e8f0}
        .bamutebi-media-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
        .bamutebi-note{max-width:900px}
    ');

    wp_add_inline_script('jquery-core', "
        jQuery(function($){
            $(document).on('click', '.bamutebi-select-media', function(e){
                e.preventDefault();
                const button = $(this);
                const target = $('#' + button.data('target'));
                const preview = $('#' + button.data('preview'));
                const frame = wp.media({ title: 'Choose image', button: { text: 'Use this image' }, multiple: false });
                frame.on('select', function(){
                    const attachment = frame.state().get('selection').first().toJSON();
                    target.val(attachment.id);
                    preview.attr('src', attachment.url);
                });
                frame.open();
            });

            $(document).on('click', '.bamutebi-clear-media', function(e){
                e.preventDefault();
                const button = $(this);
                $('#' + button.data('target')).val('');
                $('#' + button.data('preview')).attr('src', button.data('fallback'));
            });
        });
    ");
}
add_action('admin_enqueue_scripts', 'bamutebi_admin_assets');

function bamutebi_render_admin_page(): void
{
    if (!current_user_can('manage_options')) {
        return;
    }

    $settings = bamutebi_get_settings();
    $overrides = bamutebi_image_overrides();
    $assets = bamutebi_asset_relative_paths();
    ?>
    <div class="wrap">
        <h1>Bamutebi Site Controls</h1>
        <p class="bamutebi-note">Use this page to update the contact details and site images without editing code. Saving here will re-sync the Bamutebi Elementor pages automatically so the live pages reflect the new values.</p>
        <?php if (isset($_GET['updated']) && $_GET['updated'] === 'true') : ?>
            <div class="notice notice-success is-dismissible"><p>Settings saved and Bamutebi pages re-synced.</p></div>
        <?php endif; ?>
        <p>
            <a class="button button-secondary" href="<?php echo esc_url(admin_url('edit.php?post_type=page')); ?>">Open Pages</a>
            <a class="button button-secondary" href="<?php echo esc_url(admin_url('upload.php')); ?>">Open Media Library</a>
        </p>
        <ul>
            <?php foreach (bamutebi_page_map() as $slug => $config) :
                $pages = get_pages([
                    'meta_key' => BAMUTEBI_PAGE_META_KEY,
                    'meta_value' => $slug,
                    'post_type' => 'page',
                    'post_status' => ['publish', 'draft', 'private'],
                    'number' => 1,
                ]);
                $page_id = !empty($pages) ? (int) $pages[0]->ID : 0;
                if ($page_id <= 0) {
                    continue;
                }
                ?>
                <li>
                    <strong><?php echo esc_html($config['title']); ?></strong>
                    -
                    <a href="<?php echo esc_url(get_edit_post_link($page_id)); ?>">Edit Page</a>
                    |
                    <a href="<?php echo esc_url(admin_url('post.php?post=' . $page_id . '&action=elementor')); ?>">Edit with Elementor</a>
                    |
                    <a href="<?php echo esc_url(get_permalink($page_id)); ?>" target="_blank" rel="noopener noreferrer">View</a>
                </li>
            <?php endforeach; ?>
        </ul>

        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <?php wp_nonce_field('bamutebi_save_settings'); ?>
            <input type="hidden" name="action" value="bamutebi_save_settings">

            <div class="bamutebi-admin-grid">
                <section class="bamutebi-card">
                    <h2>Contact Details</h2>
                    <div class="bamutebi-field">
                        <label for="bamutebi-primary-phone-display">Primary phone label</label>
                        <input id="bamutebi-primary-phone-display" type="text" name="bamutebi_settings[primary_phone_display]" value="<?php echo esc_attr($settings['primary_phone_display']); ?>">
                    </div>
                    <div class="bamutebi-field">
                        <label for="bamutebi-primary-phone-link">Primary phone dial value</label>
                        <input id="bamutebi-primary-phone-link" type="text" name="bamutebi_settings[primary_phone_link]" value="<?php echo esc_attr($settings['primary_phone_link']); ?>">
                    </div>
                    <div class="bamutebi-field">
                        <label for="bamutebi-alt-phone-display">Alt phone label</label>
                        <input id="bamutebi-alt-phone-display" type="text" name="bamutebi_settings[alt_phone_display]" value="<?php echo esc_attr($settings['alt_phone_display']); ?>">
                    </div>
                    <div class="bamutebi-field">
                        <label for="bamutebi-alt-phone-link">Alt phone dial value</label>
                        <input id="bamutebi-alt-phone-link" type="text" name="bamutebi_settings[alt_phone_link]" value="<?php echo esc_attr($settings['alt_phone_link']); ?>">
                    </div>
                    <div class="bamutebi-field">
                        <label for="bamutebi-email">Email</label>
                        <input id="bamutebi-email" type="email" name="bamutebi_settings[email]" value="<?php echo esc_attr($settings['email']); ?>">
                    </div>
                    <div class="bamutebi-field">
                        <label for="bamutebi-location">Location</label>
                        <input id="bamutebi-location" type="text" name="bamutebi_settings[location]" value="<?php echo esc_attr($settings['location']); ?>">
                    </div>
                    <div class="bamutebi-field">
                        <label for="bamutebi-whatsapp-link">WhatsApp number</label>
                        <input id="bamutebi-whatsapp-link" type="text" name="bamutebi_settings[whatsapp_link]" value="<?php echo esc_attr($settings['whatsapp_link']); ?>">
                    </div>
                    <div class="bamutebi-field">
                        <label for="bamutebi-whatsapp-message">WhatsApp prefilled message</label>
                        <textarea id="bamutebi-whatsapp-message" name="bamutebi_settings[whatsapp_message]" rows="4"><?php echo esc_textarea($settings['whatsapp_message']); ?></textarea>
                    </div>
                </section>

                <section class="bamutebi-card">
                    <h2>Image Replacements</h2>
                    <p>Select replacement images from the Media Library. These will be used on the synced Bamutebi pages without changing the original plugin source files.</p>
                    <div class="bamutebi-media-grid">
                        <?php foreach ($assets as $asset_relative_path) :
                            $field_id = 'bamutebi-asset-' . md5($asset_relative_path);
                            $preview_id = 'bamutebi-preview-' . md5($asset_relative_path);
                            $override_id = isset($overrides[$asset_relative_path]) ? (int) $overrides[$asset_relative_path] : 0;
                            $default_url = bamutebi_default_media_url_for_asset($asset_relative_path) ?? bamutebi_asset_url($asset_relative_path);
                            $current_url = $override_id > 0 ? (wp_get_attachment_url($override_id) ?: $default_url) : $default_url;
                            ?>
                            <div class="bamutebi-media-item">
                                <strong><?php echo esc_html($asset_relative_path); ?></strong>
                                <img id="<?php echo esc_attr($preview_id); ?>" src="<?php echo esc_url($current_url); ?>" alt="">
                                <input id="<?php echo esc_attr($field_id); ?>" type="hidden" name="bamutebi_image_overrides[<?php echo esc_attr($asset_relative_path); ?>]" value="<?php echo esc_attr((string) $override_id); ?>">
                                <div class="bamutebi-media-actions">
                                    <button class="button button-secondary bamutebi-select-media" data-target="<?php echo esc_attr($field_id); ?>" data-preview="<?php echo esc_attr($preview_id); ?>">Choose Image</button>
                                    <button class="button bamutebi-clear-media" data-target="<?php echo esc_attr($field_id); ?>" data-preview="<?php echo esc_attr($preview_id); ?>" data-fallback="<?php echo esc_url($default_url); ?>">Use Default</button>
                                </div>
                            </div>
                        <?php endforeach; ?>
                    </div>
                </section>
            </div>

            <?php submit_button('Save Changes and Re-sync Pages'); ?>
        </form>
    </div>
    <?php
}

function bamutebi_save_settings(): void
{
    if (!current_user_can('manage_options')) {
        wp_die('Unauthorized.');
    }

    check_admin_referer('bamutebi_save_settings');

    $posted = isset($_POST['bamutebi_settings']) && is_array($_POST['bamutebi_settings']) ? wp_unslash($_POST['bamutebi_settings']) : [];
    $defaults = bamutebi_default_settings();
    $settings = [];

    foreach ($defaults as $key => $default_value) {
        $value = isset($posted[$key]) ? (string) $posted[$key] : $default_value;

        switch ($key) {
            case 'email':
                $settings[$key] = sanitize_email($value);
                break;
            case 'whatsapp_message':
            case 'location':
            case 'primary_phone_display':
            case 'alt_phone_display':
                $settings[$key] = sanitize_text_field($value);
                break;
            case 'primary_phone_link':
            case 'alt_phone_link':
            case 'whatsapp_link':
                $settings[$key] = preg_replace('/[^0-9+]/', '', $value) ?: $default_value;
                break;
            default:
                $settings[$key] = sanitize_text_field($value);
        }
    }

    $posted_overrides = isset($_POST['bamutebi_image_overrides']) && is_array($_POST['bamutebi_image_overrides']) ? wp_unslash($_POST['bamutebi_image_overrides']) : [];
    $valid_assets = array_flip(bamutebi_asset_relative_paths());
    $overrides = [];

    foreach ($posted_overrides as $asset_relative_path => $attachment_id) {
        if (!isset($valid_assets[$asset_relative_path])) {
            continue;
        }

        $attachment_id = (int) $attachment_id;
        if ($attachment_id > 0) {
            $overrides[$asset_relative_path] = $attachment_id;
        }
    }

    update_option(BAMUTEBI_SETTINGS_OPTION, $settings);
    update_option(BAMUTEBI_IMAGE_OVERRIDES_OPTION, $overrides);
    bamutebi_upsert_pages();
    update_option(BAMUTEBI_SYNC_OPTION, BAMUTEBI_BRIDGE_VERSION);

    wp_safe_redirect(add_query_arg([
        'page' => 'bamutebi-site',
        'updated' => 'true',
    ], admin_url('admin.php')));
    exit;
}
add_action('admin_post_bamutebi_save_settings', 'bamutebi_save_settings');

function bamutebi_sync_bridge(): void
{
    bamutebi_ensure_settings_defaults();

    $current_version = get_option(BAMUTEBI_SYNC_OPTION);
    $plugin_version = BAMUTEBI_BRIDGE_VERSION;

    if ($current_version === $plugin_version) {
        return;
    }

    bamutebi_upsert_pages();
    update_option(BAMUTEBI_SYNC_OPTION, $plugin_version);
}

function bamutebi_activate_bridge(): void
{
    bamutebi_ensure_settings_defaults();
    bamutebi_upsert_pages();
    update_option(BAMUTEBI_SYNC_OPTION, BAMUTEBI_BRIDGE_VERSION);
}
register_activation_hook(__FILE__, 'bamutebi_activate_bridge');

add_action('admin_init', 'bamutebi_sync_bridge');
