const navToggle = document.querySelector('.nav-toggle');
const siteNav = document.querySelector('.site-nav');
const header = document.querySelector('.site-header');

const closeNav = () => {
    if (!navToggle || !siteNav) {
        return;
    }

    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open navigation');
    siteNav.classList.remove('open');
    document.body.classList.remove('nav-open');
};

const openNav = () => {
    if (!navToggle || !siteNav) {
        return;
    }

    navToggle.setAttribute('aria-expanded', 'true');
    navToggle.setAttribute('aria-label', 'Close navigation');
    siteNav.classList.add('open');
    document.body.classList.add('nav-open');
};

if (navToggle && siteNav) {
    navToggle.addEventListener('click', () => {
        const isExpanded = navToggle.getAttribute('aria-expanded') === 'true';
        if (isExpanded) {
            closeNav();
        } else {
            openNav();
        }
    });

    siteNav.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            closeNav();
        });
    });

    document.addEventListener('click', (event) => {
        if (window.innerWidth > 980) {
            return;
        }

        if (!siteNav.classList.contains('open')) {
            return;
        }

        if (siteNav.contains(event.target) || navToggle.contains(event.target)) {
            return;
        }

        closeNav();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeNav();
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 980) {
            closeNav();
        }
    });
}

if (siteNav) {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    siteNav.querySelectorAll('a').forEach((link) => {
        const linkPage = link.getAttribute('href');
        const isCurrent = linkPage === currentPage || (currentPage === '' && linkPage === 'index.html');
        link.classList.toggle('active', isCurrent);
        if (isCurrent) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
    });
}

window.addEventListener('scroll', () => {
    if (!header) {
        return;
    }

    header.classList.toggle('scrolled', window.scrollY > 12);
});

document.querySelectorAll('.faq-question').forEach((button) => {
    button.addEventListener('click', () => {
        const item = button.closest('.faq-item');
        const isOpen = button.getAttribute('aria-expanded') === 'true';

        document.querySelectorAll('.faq-item.open').forEach((openItem) => {
            if (openItem !== item) {
                openItem.classList.remove('open');
                const openButton = openItem.querySelector('.faq-question');
                if (openButton) {
                    openButton.setAttribute('aria-expanded', 'false');
                }
            }
        });

        button.setAttribute('aria-expanded', String(!isOpen));
        if (item) {
            item.classList.toggle('open', !isOpen);
        }
    });
});

const revealItems = document.querySelectorAll('[data-reveal]');

if ('IntersectionObserver' in window && revealItems.length) {
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.18,
        rootMargin: '0px 0px -8% 0px'
    });

    revealItems.forEach((item, index) => {
        item.style.setProperty('--reveal-delay', `${Math.min(index * 45, 240)}ms`);
        revealObserver.observe(item);
    });
} else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
}

const enquiryForm = document.querySelector('[data-enquiry-form]');

if (enquiryForm) {
    const status = enquiryForm.querySelector('[data-form-status]');
    const whatsappLink = document.querySelector('a[href*="wa.me/"]');
    const mailtoLink = document.querySelector('a[href^="mailto:"]');
    let whatsappBase = '';

    if (whatsappLink) {
        try {
            const url = new URL(whatsappLink.href, window.location.origin);
            whatsappBase = `${url.origin}${url.pathname}?text=`;
        } catch (error) {
            whatsappBase = whatsappLink.getAttribute('href')?.split('?')[0] ? `${whatsappLink.getAttribute('href')?.split('?')[0]}?text=` : '';
        }
    }

    enquiryForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const formData = new FormData(enquiryForm);
        const name = String(formData.get('name') || '').trim();
        const email = String(formData.get('email') || '').trim();
        const phone = String(formData.get('phone') || '').trim();
        const service = String(formData.get('service') || '').trim();
        const message = String(formData.get('message') || '').trim();

        const requiredFields = Array.from(enquiryForm.querySelectorAll('[required]'));
        const firstInvalid = requiredFields.find((field) => !field.value.trim());

        if (firstInvalid) {
            if (status) {
                status.textContent = 'Please complete all required fields before continuing.';
                status.classList.add('is-visible');
                status.classList.remove('is-success');
            }
            firstInvalid.focus();
            return;
        }

        const whatsappMessage = [
            'Hello Bamutebi Property Managers,',
            '',
            'I would like to make an enquiry.',
            '',
            `Name: ${name}`,
            `Email: ${email}`,
            `Phone: ${phone}`,
            `Service Needed: ${service}`,
            '',
            'Enquiry:',
            message
        ].join('\n');

        if (status) {
            status.textContent = 'Opening WhatsApp with your enquiry now.';
            status.classList.add('is-visible', 'is-success');
        }

        const whatsappUrl = whatsappBase ? `${whatsappBase}${encodeURIComponent(whatsappMessage)}` : '';
        const fallbackEmail = mailtoLink ? mailtoLink.getAttribute('href') : '';
        const mailtoUrl = fallbackEmail
            ? `${fallbackEmail}?subject=${encodeURIComponent('Property enquiry')}&body=${encodeURIComponent(whatsappMessage)}`
            : '';

        const popup = whatsappUrl ? window.open(whatsappUrl, '_blank', 'noopener') : null;

        if (!popup && mailtoUrl) {
            if (status) {
                status.textContent = 'WhatsApp could not open automatically. Your email app is opening instead.';
            }
            window.location.href = mailtoUrl;
        }
    });
}
