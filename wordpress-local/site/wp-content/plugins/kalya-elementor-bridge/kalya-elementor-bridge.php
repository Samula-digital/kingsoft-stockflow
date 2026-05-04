<?php
/**
 * Plugin Name: Kalya Elementor Bridge
 * Description: Recreates the Kalya Courts hardcoded site inside WordPress Elementor canvas pages.
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

const KALYA_SOURCE_ROOT = '/Users/mac/Downloads/kalya-courts-hardcoded-site';
const KALYA_PAGE_META_KEY = '_kalya_source_slug';
const KALYA_FEED_CACHE_TTL = 300;

function kalya_page_map(): array
{
    return [
        'home' => 'index.html',
        'rooms' => 'rooms.html',
        'conferences' => 'conferences.html',
        'events' => 'events.html',
        'restaurant' => 'restaurant.html',
        'offers' => 'offers.html',
        'location' => 'location.html',
        'contact' => 'contact.html',
    ];
}

function kalya_asset_url(string $path = ''): string
{
    return plugins_url('assets/' . ltrim($path, '/'), __FILE__);
}

function kalya_current_page_slug(): ?string
{
    if (!is_singular('page')) {
        return null;
    }

    $postId = get_queried_object_id();
    if (!$postId) {
        return null;
    }

    $slug = get_post_meta($postId, KALYA_PAGE_META_KEY, true);
    return is_string($slug) && $slug !== '' ? $slug : null;
}

function kalya_source_path(string $slug): ?string
{
    $map = kalya_page_map();
    if (!isset($map[$slug])) {
        return null;
    }

    $path = KALYA_SOURCE_ROOT . '/' . $map[$slug];
    return is_readable($path) ? $path : null;
}

function kalya_read_source(string $slug): ?string
{
    $path = kalya_source_path($slug);
    if ($path === null) {
        return null;
    }

    $html = file_get_contents($path);
    return is_string($html) ? $html : null;
}

function kalya_extract_body_markup(string $html): string
{
    if (preg_match('~<body[^>]*>(.*?)(?:<script\s+src="assets/js/app\.js"></script>\s*)</body>~is', $html, $match) === 1) {
        return trim($match[1]);
    }

    if (preg_match('~<body[^>]*>(.*)</body>~is', $html, $match) === 1) {
        return trim($match[1]);
    }

    return $html;
}

function kalya_extract_head_markup(string $html): string
{
    if (preg_match('~<head[^>]*>(.*)</head>~is', $html, $match) === 1) {
        return trim($match[1]);
    }

    return '';
}

function kalya_internal_page_urls(): array
{
    return [
        'index.html' => home_url('/'),
        'rooms.html' => home_url('/rooms/'),
        'conferences.html' => home_url('/conferences/'),
        'events.html' => home_url('/events/'),
        'restaurant.html' => home_url('/restaurant/'),
        'offers.html' => home_url('/offers/'),
        'location.html' => home_url('/location/'),
        'contact.html' => home_url('/contact/'),
    ];
}

function kalya_transform_markup(string $markup): string
{
    $replacements = kalya_internal_page_urls();
    $replacements['lead-capture.php'] = admin_url('admin-ajax.php?action=kalya_lead_capture');
    $replacements['social-feed.php'] = admin_url('admin-ajax.php?action=kalya_social_feed');
    $replacements['assets/'] = kalya_asset_url();

    return str_replace(array_keys($replacements), array_values($replacements), $markup);
}

function kalya_render_source_page(string $slug): string
{
    $source = kalya_read_source($slug);
    if ($source === null) {
        return '<div class="kalya-missing-page">Kalya source page not found.</div>';
    }

    $markup = kalya_extract_body_markup($source);
    $markup = kalya_transform_markup($markup);

    return '<div class="kalya-source-page kalya-source-page-' . esc_attr($slug) . '">' . $markup . '</div>';
}

function kalya_source_page_shortcode(array $atts): string
{
    $atts = shortcode_atts(
        [
            'slug' => '',
        ],
        $atts,
        'kalya_source_page'
    );

    $slug = sanitize_key((string) $atts['slug']);
    if ($slug === '') {
        return '';
    }

    return kalya_render_source_page($slug);
}
add_shortcode('kalya_source_page', 'kalya_source_page_shortcode');

function kalya_enqueue_assets(): void
{
    $slug = kalya_current_page_slug();
    if ($slug === null) {
        return;
    }

    wp_enqueue_style(
        'kalya-google-fonts',
        'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap',
        [],
        null
    );
    wp_enqueue_style(
        'kalya-site-styles',
        kalya_asset_url('css/styles.css'),
        ['kalya-google-fonts'],
        filemtime(plugin_dir_path(__FILE__) . 'assets/css/styles.css')
    );
    wp_enqueue_style(
        'kalya-editable-styles',
        kalya_asset_url('css/elementor-editable.css'),
        ['kalya-site-styles'],
        filemtime(plugin_dir_path(__FILE__) . 'assets/css/elementor-editable.css')
    );
    wp_enqueue_script(
        'kalya-site-app',
        kalya_asset_url('js/app.js'),
        [],
        filemtime(plugin_dir_path(__FILE__) . 'assets/js/app.js'),
        true
    );
}
add_action('wp_enqueue_scripts', 'kalya_enqueue_assets');

function kalya_cleanup_wordpress_frontend(): void
{
    if (kalya_current_page_slug() === null) {
        return;
    }

    wp_dequeue_style('wp-block-library');
    wp_dequeue_style('classic-theme-styles');
    wp_dequeue_style('global-styles');
    remove_action('wp_head', 'rsd_link');
    remove_action('wp_head', 'wlwmanifest_link');
    remove_action('wp_head', 'wp_generator');
    remove_action('wp_head', 'rest_output_link_wp_head');
    remove_action('wp_head', 'wp_oembed_add_discovery_links');
}
add_action('wp_enqueue_scripts', 'kalya_cleanup_wordpress_frontend', 100);

function kalya_source_title(string $slug): ?string
{
    $source = kalya_read_source($slug);
    if ($source === null) {
        return null;
    }

    if (preg_match('~<title>(.*?)</title>~is', $source, $match) !== 1) {
        return null;
    }

    return html_entity_decode(trim(wp_strip_all_tags($match[1])), ENT_QUOTES);
}

function kalya_document_title(string $title): string
{
    $slug = kalya_current_page_slug();
    if ($slug === null) {
        return $title;
    }

    return kalya_source_title($slug) ?: $title;
}
add_filter('pre_get_document_title', 'kalya_document_title');

function kalya_head_scripts(): void
{
    $slug = kalya_current_page_slug();
    if ($slug === null) {
        return;
    }

    $source = kalya_read_source($slug);
    if ($source === null) {
        return;
    }

    $head = kalya_extract_head_markup($source);
    if ($head !== '') {
        if (preg_match('~<meta name="description" content="([^"]*)"\s*/?>~i', $head, $meta) === 1) {
            echo '<meta name="description" content="' . esc_attr($meta[1]) . '">' . "\n";
        }
        if (preg_match('~<link rel="canonical" href="([^"]*)"\s*/?>~i', $head, $canonical) === 1) {
            echo '<link rel="canonical" href="' . esc_url(home_url(add_query_arg([], $GLOBALS['wp']->request ? '/' . $GLOBALS['wp']->request . '/' : '/'))) . '">' . "\n";
        }
        if (preg_match('~<link rel="icon" href="([^"]*)" type="([^"]*)"\s*/?>~i', $head, $icon) === 1) {
            echo '<link rel="icon" href="' . esc_url(kalya_asset_url('img/' . basename($icon[1]))) . '" type="' . esc_attr($icon[2]) . '">' . "\n";
        }
        if (preg_match_all('~<meta property="([^"]+)" content="([^"]*)"\s*/?>~i', $head, $ogMeta, PREG_SET_ORDER) !== false) {
            foreach ($ogMeta as $tag) {
                $content = $tag[2];
                if ($tag[1] === 'og:url') {
                    $content = home_url(add_query_arg([], $GLOBALS['wp']->request ? '/' . $GLOBALS['wp']->request . '/' : '/'));
                } elseif ($tag[1] === 'og:image') {
                    $content = kalya_asset_url('img/' . basename($content));
                }
                echo '<meta property="' . esc_attr($tag[1]) . '" content="' . esc_attr($content) . '">' . "\n";
            }
        }
        if (preg_match_all('~<meta name="([^"]+)" content="([^"]*)"\s*/?>~i', $head, $namedMeta, PREG_SET_ORDER) !== false) {
            foreach ($namedMeta as $tag) {
                if (in_array(strtolower($tag[1]), ['description'], true)) {
                    continue;
                }
                echo '<meta name="' . esc_attr($tag[1]) . '" content="' . esc_attr($tag[2]) . '">' . "\n";
            }
        }
    }

    if (preg_match('~<script async src="https://www\.googletagmanager\.com/gtag/js\?id=G-HRTN09MFGQ"></script>\s*<script>(.*?)</script>~is', $source, $gtag) === 1) {
        echo '<script async src="https://www.googletagmanager.com/gtag/js?id=G-HRTN09MFGQ"></script>' . "\n";
        echo "<script>\n" . trim($gtag[1]) . "\n</script>\n";
    }

    if (preg_match_all('~<script type="application/ld\+json">(.*?)</script>~is', $source, $matches) === false) {
        return;
    }

    foreach ($matches[1] as $jsonLd) {
        echo "<script type=\"application/ld+json\">" . trim($jsonLd) . "</script>\n";
    }
}
add_action('wp_head', 'kalya_head_scripts', 20);

function kalya_json_response(int $status, array $payload): void
{
    status_header($status);
    wp_send_json($payload, $status);
}

function kalya_clean_input(string $key): string
{
    $value = $_POST[$key] ?? '';
    $value = is_string($value) ? $value : '';
    $value = wp_strip_all_tags($value);
    return trim((string) preg_replace('/\s+/', ' ', $value));
}

function kalya_handle_lead_capture(): void
{
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        kalya_json_response(405, ['success' => false, 'message' => 'Method not allowed.']);
    }

    $leadType = kalya_clean_input('lead_type');
    $pageUrl = esc_url_raw((string) ($_POST['page_url'] ?? ''));
    $pageTitle = kalya_clean_input('page_title');
    $allowedLeadTypes = ['booking_request', 'event_enquiry'];

    if (!in_array($leadType, $allowedLeadTypes, true)) {
        kalya_json_response(422, ['success' => false, 'message' => 'Unsupported lead type.']);
    }

    if ($leadType === 'booking_request') {
        $fields = [
            'name' => kalya_clean_input('name'),
            'phone' => kalya_clean_input('phone'),
            'email' => sanitize_email((string) ($_POST['email'] ?? '')),
            'check_in' => kalya_clean_input('check_in'),
            'check_out' => kalya_clean_input('check_out'),
            'guests' => kalya_clean_input('guests'),
            'stay_type' => kalya_clean_input('stay_type'),
            'notes' => kalya_clean_input('notes'),
        ];
        $required = ['name', 'phone', 'check_in', 'check_out', 'guests', 'stay_type'];
        $subjectLine = 'New website booking request: ' . $fields['check_in'] . ' to ' . $fields['check_out'];
        $emailBody = [
            'Kalya Courts website lead',
            'Captured at: ' . gmdate('Y-m-d H:i:s') . ' UTC',
            'Lead type: booking_request',
            'Page title: ' . ($pageTitle ?: 'Unknown'),
            'Page URL: ' . ($pageUrl ?: 'Unknown'),
            '',
            'Guest name: ' . $fields['name'],
            'Phone: ' . $fields['phone'],
            'Email: ' . ($fields['email'] ?: 'Not provided'),
            'Check-in: ' . $fields['check_in'],
            'Check-out: ' . $fields['check_out'],
            'Guests: ' . $fields['guests'],
            'Purpose: ' . $fields['stay_type'],
            'Notes: ' . ($fields['notes'] ?: 'None'),
        ];
    } else {
        $fields = [
            'name' => kalya_clean_input('name'),
            'phone' => kalya_clean_input('phone'),
            'email' => sanitize_email((string) ($_POST['email'] ?? '')),
            'subject' => kalya_clean_input('subject'),
            'event_date' => kalya_clean_input('event_date'),
            'attendees' => kalya_clean_input('attendees'),
            'message' => kalya_clean_input('message'),
        ];
        $required = ['name', 'phone', 'subject', 'event_date', 'attendees', 'message'];
        $subjectLine = 'New website event enquiry: ' . $fields['subject'];
        $emailBody = [
            'Kalya Courts website lead',
            'Captured at: ' . gmdate('Y-m-d H:i:s') . ' UTC',
            'Lead type: event_enquiry',
            'Page title: ' . ($pageTitle ?: 'Unknown'),
            'Page URL: ' . ($pageUrl ?: 'Unknown'),
            '',
            'Name: ' . $fields['name'],
            'Phone: ' . $fields['phone'],
            'Email: ' . ($fields['email'] ?: 'Not provided'),
            'Subject: ' . $fields['subject'],
            'Preferred date: ' . $fields['event_date'],
            'Expected attendees: ' . $fields['attendees'],
            'Message: ' . $fields['message'],
        ];
    }

    foreach ($required as $field) {
        if (($fields[$field] ?? '') === '') {
            kalya_json_response(422, ['success' => false, 'message' => 'Please complete all required fields.']);
        }
    }

    $upload = wp_upload_dir();
    $storageDir = trailingslashit($upload['basedir']) . 'kalya-leads';
    if (!is_dir($storageDir)) {
        wp_mkdir_p($storageDir);
    }
    $storageFile = trailingslashit($storageDir) . 'leads.ndjson';
    $storedLead = [
        'captured_at' => gmdate('c'),
        'lead_type' => $leadType,
        'page_url' => $pageUrl,
        'page_title' => $pageTitle,
        'fields' => $fields,
    ];
    $stored = (bool) file_put_contents($storageFile, wp_json_encode($storedLead, JSON_UNESCAPED_SLASHES) . PHP_EOL, FILE_APPEND | LOCK_EX);

    $headers = [
        'Content-Type: text/plain; charset=UTF-8',
        'From: Kalya Courts Website <info@kalyacourtshotel.com>',
    ];
    if (!empty($fields['email'])) {
        $headers[] = 'Reply-To: ' . $fields['email'];
    }

    $mailed = wp_mail('info@kalyacourtshotel.com', $subjectLine, implode(PHP_EOL, $emailBody), $headers);

    if (!$stored && !$mailed) {
        kalya_json_response(500, ['success' => false, 'message' => 'Lead capture failed.']);
    }

    kalya_json_response(200, [
        'success' => true,
        'message' => 'Lead captured successfully.',
        'stored' => $stored,
        'mailed' => $mailed,
    ]);
}
add_action('wp_ajax_kalya_lead_capture', 'kalya_handle_lead_capture');
add_action('wp_ajax_nopriv_kalya_lead_capture', 'kalya_handle_lead_capture');

function kalya_feed_cache_file(): string
{
    $upload = wp_upload_dir();
    return trailingslashit($upload['basedir']) . 'kalya-social-feed-cache.json';
}

function kalya_fetch_url(string $url, array $headers = []): ?string
{
    $args = [
        'timeout' => 20,
        'headers' => $headers,
        'user-agent' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    ];
    $response = wp_remote_get($url, $args);
    if (is_wp_error($response)) {
        return null;
    }

    $status = (int) wp_remote_retrieve_response_code($response);
    if ($status < 200 || $status >= 400) {
        return null;
    }

    return wp_remote_retrieve_body($response);
}

function kalya_fetch_instagram_latest(string $username): array
{
    $body = kalya_fetch_url(
        'https://www.instagram.com/api/v1/users/web_profile_info/?username=' . rawurlencode($username),
        [
            'Accept' => 'application/json',
            'x-ig-app-id' => '936619743392459',
        ]
    );

    if ($body === null || $body === '') {
        return ['url' => null, 'note' => 'Instagram fetch failed'];
    }

    if (preg_match('/"shortcode":"([A-Za-z0-9_-]{6,})"/', $body, $match) === 1) {
        return ['url' => 'https://www.instagram.com/p/' . $match[1] . '/', 'note' => null];
    }

    return ['url' => null, 'note' => 'Instagram latest post not parsed'];
}

function kalya_fetch_tiktok_latest(string $username): array
{
    $body = kalya_fetch_url(
        'https://www.tiktok.com/@' . rawurlencode($username),
        [
            'Accept-Language' => 'en-US,en;q=0.9',
        ]
    );

    if ($body === null || $body === '') {
        return ['url' => null, 'note' => 'TikTok fetch failed'];
    }

    if (strpos($body, '"statusCode":10221') !== false) {
        return ['url' => null, 'note' => 'TikTok profile not found'];
    }

    if (preg_match('/"itemId":"([0-9]{12,})"/', $body, $match) === 1) {
        return ['url' => 'https://www.tiktok.com/@' . $username . '/video/' . $match[1], 'note' => null];
    }

    return ['url' => null, 'note' => 'TikTok latest post not parsed'];
}

function kalya_handle_social_feed(): void
{
    $cacheFile = kalya_feed_cache_file();
    if (is_readable($cacheFile)) {
        $cachedRaw = file_get_contents($cacheFile);
        $cached = is_string($cachedRaw) ? json_decode($cachedRaw, true) : null;
        if (is_array($cached) && isset($cached['generated_at_unix'])) {
            $age = time() - (int) $cached['generated_at_unix'];
            if ($age >= 0 && $age < KALYA_FEED_CACHE_TTL) {
                wp_send_json($cached);
            }
        }
    }

    $result = [
        'generated_at' => gmdate('c'),
        'generated_at_unix' => time(),
        'instagram' => [
            'url' => 'https://www.instagram.com/p/DUm4hLIjEZp/',
            'profile_url' => 'https://www.instagram.com/kalyacourtshotel/',
            'fallback' => true,
        ],
        'tiktok' => [
            'url' => 'https://www.tiktok.com/@kalya.courts.hotel',
            'profile_url' => 'https://www.tiktok.com/@kalya.courts.hotel',
            'fallback' => true,
        ],
    ];

    $instagram = kalya_fetch_instagram_latest('kalyacourtshotel');
    if ($instagram['url'] !== null) {
        $result['instagram']['url'] = $instagram['url'];
        $result['instagram']['fallback'] = false;
    }
    if ($instagram['note'] !== null) {
        $result['instagram']['note'] = $instagram['note'];
    }

    $tiktok = kalya_fetch_tiktok_latest('kalya.courts.hotel');
    if ($tiktok['url'] !== null) {
        $result['tiktok']['url'] = $tiktok['url'];
        $result['tiktok']['fallback'] = false;
    }
    if ($tiktok['note'] !== null) {
        $result['tiktok']['note'] = $tiktok['note'];
    }

    file_put_contents($cacheFile, wp_json_encode($result, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
    wp_send_json($result);
}
add_action('wp_ajax_kalya_social_feed', 'kalya_handle_social_feed');
add_action('wp_ajax_nopriv_kalya_social_feed', 'kalya_handle_social_feed');
