<?php
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

$slug = bamutebi_current_page_slug();
if ($slug === null) {
    status_header(404);
    exit;
}
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <?php wp_head(); ?>
</head>
<body <?php body_class('bamutebi-bridge-page'); ?>>
<?php wp_body_open(); ?>
<?php echo bamutebi_render_source_page($slug); ?>
<?php wp_footer(); ?>
</body>
</html>
