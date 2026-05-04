<?php
/**
 * The base configuration for WordPress
 *
 * The wp-config.php creation script uses this file during the installation.
 * You don't have to use the web site, you can copy this file to "wp-config.php"
 * and fill in the values.
 *
 * This file contains the following configurations:
 *
 * * Database settings
 * * Secret keys
 * * Database table prefix
 * * Localized language
 * * ABSPATH
 *
 * @link https://wordpress.org/support/article/editing-wp-config-php/
 *
 * @package WordPress
 */

// ** Database settings - You can get this info from your web host ** //
/** The name of the database for WordPress */
define( 'DB_NAME', 'wordpress_local' );

/** Database username */
define( 'DB_USER', 'wordpress' );

/** Database password */
define( 'DB_PASSWORD', 'wordpress' );

/** Database hostname */
define( 'DB_HOST', 'localhost:/tmp/mysql.sock' );

/** Database charset to use in creating database tables. */
define( 'DB_CHARSET', 'utf8mb4' );

/** The database collate type. Don't change this if in doubt. */
define( 'DB_COLLATE', '' );

/**#@+
 * Authentication unique keys and salts.
 *
 * Change these to different unique phrases! You can generate these using
 * the {@link https://api.wordpress.org/secret-key/1.1/salt/ WordPress.org secret-key service}.
 *
 * You can change these at any point in time to invalidate all existing cookies.
 * This will force all users to have to log in again.
 *
 * @since 2.6.0
 */
define( 'AUTH_KEY',          'E1yCk_Z[SVke^K5Z.Ln)t>%XF)ZYqaoVv9ln~9uFMQR %RTO]p-#V3E(+ww0E[^B' );
define( 'SECURE_AUTH_KEY',   '?{V6 cNXV4`:QF49X6I&7;NcTGpxq1AK7sTQ3+CLa-O D=#7M~`k6S:PoFoe@?k#' );
define( 'LOGGED_IN_KEY',     '|Fst5Gn,^|16nB:G ]){{!5`J rH%lVsX#yqJ8Qplh<H2%gM>Ip3Q]kJmd%Ehm#Y' );
define( 'NONCE_KEY',         'Q|Cq|>%R8NQGTp@4cfi|JP?8,e,9GzZPcM|w|a03@p{]$e+nU{({kyY2N+*o[W#M' );
define( 'AUTH_SALT',         '^iHL6Hpyq^C V4nmhIUqrN@s+l0nAJZ(n@Pe<n<z5qWnIBlX<O6M2sC8k`O^>pgi' );
define( 'SECURE_AUTH_SALT',  '>J)gG((G#?iggPitPP_EmQV^$G`,H|ph0r3jld~OxMe>BB*XRRi.V,JcLM=hw1/C' );
define( 'LOGGED_IN_SALT',    'rVU*9O`kpNf!.-(wr0]nop<]b?OE4tBo4A<j(k5 ,Z>I#vtdtp3-wxI2RukSbJ8}' );
define( 'NONCE_SALT',        'b{f9$:Y&7UK0qS0=GqDk~.sRWi`8N?9fp{f!HuTg`6Bo@2f(T7rq>vTmk7|;+oqQ' );
define( 'WP_CACHE_KEY_SALT', 'du%n,P 41?gp(nW?]D>g;>jB9=e|hx~T|#1aK[.$_<XUIm#^qA~V.hQWR=]gtp5q' );


/**#@-*/

/**
 * WordPress database table prefix.
 *
 * You can have multiple installations in one database if you give each
 * a unique prefix. Only numbers, letters, and underscores please!
 */
$table_prefix = 'wp_';


/* Add any custom values between this line and the "stop editing" line. */

define( 'WP_ENVIRONMENT_TYPE', 'local' );
define( 'FS_METHOD', 'direct' );


/**
 * For developers: WordPress debugging mode.
 *
 * Change this to true to enable the display of notices during development.
 * It is strongly recommended that plugin and theme developers use WP_DEBUG
 * in their development environments.
 *
 * For information on other constants that can be used for debugging,
 * visit the documentation.
 *
 * @link https://wordpress.org/support/article/debugging-in-wordpress/
 */
if ( ! defined( 'WP_DEBUG' ) ) {
	define( 'WP_DEBUG', false );
}

/* That's all, stop editing! Happy publishing. */

/** Absolute path to the WordPress directory. */
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}

/** Sets up WordPress vars and included files. */
require_once ABSPATH . 'wp-settings.php';
