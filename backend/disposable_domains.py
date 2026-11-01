"""Small blocklist of disposable / throwaway email domains used to reject
obvious junk signups. Not exhaustive by design - it catches the common ones
without external calls. Add more as needed."""

DISPOSABLE_DOMAINS = {
    "mailinator.com", "guerrillamail.com", "guerrillamail.info", "sharklasers.com",
    "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org",
    "yopmail.com", "throwawaymail.com", "getnada.com", "nada.email", "trashmail.com",
    "dispostable.com", "maildrop.cc", "mailnesia.com", "mintemail.com", "fakeinbox.com",
    "spam4.me", "mytemp.email", "moakt.com", "emailondeck.com", "mohmal.com",
    "tempmailo.com", "tempinbox.com", "burnermail.io", "33mail.com", "temp-mail.io",
    "discard.email", "mailcatch.com", "trbvm.com", "inboxkitten.com", "harakirimail.com",
}


def is_disposable_email(email: str) -> bool:
    try:
        domain = (email or "").strip().lower().rsplit("@", 1)[1]
    except IndexError:
        return False
    return domain in DISPOSABLE_DOMAINS
