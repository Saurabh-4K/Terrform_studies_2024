package com.salaryrunway.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads one bank or UPI SMS when it arrives, while the app may be closed.
 * A copy of parseSms() in core.js: keep the two in step. The app's own
 * reader stays the reference; this one only makes the first guess shown in
 * the notification.
 */
final class SmsParser {

    static final class Result {
        String type;      // "debit", "credit", "statement" (card bill) or "cardpayment"
        long amount;      // for a statement: the total due
        String merchant;
        String category;
        boolean salary;
        String paidFrom;  // "card" or "account" (debit and credit)
        String last4;     // card's last 4 digits, when on a card
    }

    private static final int CI = Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE;
    private static final Pattern NOT_PAYMENT = Pattern.compile("\\botp\\b|one time password|verification code", CI);
    private static final Pattern AMOUNT = Pattern.compile("(?:rs\\.?|inr|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)", CI);
    private static final Pattern DEBIT = Pattern.compile("\\b(debited|spent|paid|sent|withdrawn|purchase|debit|payment of)\\b", CI);
    private static final Pattern CREDIT = Pattern.compile("\\b(credited|received|deposited|refund(?:ed)?)\\b", CI);
    private static final Pattern REFUND = Pattern.compile("refund|reversal|reversed|cashback", CI);
    private static final Pattern SALARY = Pattern.compile("\\bsal(ary)?\\b|payroll", CI);
    private static final Pattern NOT_A_NAME = Pattern.compile("^(a/?c|your|ac|account|card)\\b", CI);
    private static final Pattern VPA = Pattern.compile("\\b([a-z0-9._-]+@[a-z]+)\\b", CI);

    // Credit cards, as in core.js.
    private static final Pattern CARD_HINT = Pattern.compile("credit card|\\bcc\\b|card\\s*(?:no\\.?|number|ending|xx|\\*{2})|avl\\.?\\s*limit|available\\s*limit|avail\\.?\\s*lmt", CI);
    private static final Pattern DEBIT_CARD = Pattern.compile("debit card", CI);
    private static final Pattern STATEMENT = Pattern.compile("\\b(?:statement|stmt)\\b", CI);
    private static final Pattern TOTAL_DUE = Pattern.compile("total\\s*(?:amount|amt\\.?)?\\s*due\\s*(?:is|of|:|-)?\\s*(?:rs\\.?|inr|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)", CI);
    private static final Pattern MIN_DUE = Pattern.compile("min(?:imum)?\\.?\\s*(?:amount|amt\\.?)?\\s*due\\s*(?:is|of|:|-)?\\s*(?:rs\\.?|inr|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)", CI);
    private static final Pattern CARD_PAYMENT = Pattern.compile("(?:payment|pymt)(?:(?!\\.\\s).){0,50}(?:received|credited|successful|processed)|(?:received|credited)(?:(?!\\.\\s).){0,40}(?:payment|pymt)|thank you for (?:the |your )?payment|towards(?:(?!\\.\\s).){0,40}credit card|credit card(?:(?!\\.\\s).){0,30}(?:bill|payment)", CI);
    private static final Pattern CARD_LAST4 = Pattern.compile("card[^0-9]{0,25}?(\\d{4})\\b", CI);
    private static final Pattern HAS_CARD = Pattern.compile("card", CI);

    private static final Pattern[] CREDIT_FROM = {
        Pattern.compile("\\bfrom\\s+(?:vpa\\s+)?([A-Za-z0-9@._&'/ -]{2,50}?)(?=\\s+(?:on|via|ref|upi|txn|for|avl|avbl|to|dt|date)\\b|\\s*[.,;(]\\s|\\s*[.,;]?$)", CI),
        VPA,
    };
    private static final Pattern[] DEBIT_TO = {
        Pattern.compile("\\binfo[:\\s]+(\\S.*?)(?=\\.\\s|\\.$|$|\\s+avl)", CI),
        Pattern.compile("\\b(?:to|at|towards)\\s+(?:vpa\\s+)?([A-Za-z0-9@._&'/ -]{2,50}?)(?=\\s+(?:on|via|ref|upi|txn|for|avl|avbl|from|using|dt|date|received)\\b|\\s*[.,;(]\\s|\\s*[.,;]?$)", CI),
        Pattern.compile("\\bon\\s+([A-Z][A-Z0-9 &'-]{2,30})(?=\\s*[.,]|\\s+avl)"),
        VPA,
    };

    private static final String[][] CATEGORY_KEYWORDS = {
        { "Food & dining", "swiggy", "zomato", "eatsure", "dominos", "pizza", "mcdonald", "kfc", "cafe", "restaurant", "starbucks", "chai" },
        { "Groceries", "bigbasket", "blinkit", "zepto", "dmart", "jiomart", "grofers", "reliance fresh", "more retail", "kirana", "instamart", "grocery" },
        { "Travel", "uber", "ola", "rapido", "irctc", "redbus", "makemytrip", "indigo", "petrol", "fuel", "hpcl", "iocl", "bpcl", "metro", "fastag" },
        { "Shopping", "amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "decathlon", "croma" },
        { "Entertainment", "netflix", "spotify", "hotstar", "prime video", "bookmyshow", "pvr", "inox", "youtube", "sonyliv" },
        { "Health", "pharmacy", "apollo", "medplus", "1mg", "pharmeasy", "hospital", "clinic", "diagnostic", "netmeds" },
        { "Personal care", "salon", "urban company", "urbanclap", "spa", "barber" },
        { "Bills", "recharge", "airtel", "jio", "vodafone", "bsnl", "electricity", "bescom", "msedcl", "tata power", "adani electricity", "torrent power", "tneb", "bses", "indane", "hp gas", "bharatgas", "bharat gas", "mahanagar gas", "water bill", "broadband", "fibernet", "hathway" },
        // Money moved to savings or investments. "=" means a whole word.
        { "Savings", "=jar", "changejar", "groww", "zerodha", "kuvera", "upstox", "paytm money", "indmoney", "etmoney", "mutual fund", "=sip", "=nps", "=ppf", "recurring deposit", "fixed deposit", "safegold", "digigold", "digital gold", "augmont", "gullak" },
    };

    private static boolean keywordMatches(String lower, String w) {
        return w.startsWith("=")
            ? Pattern.compile("\\b" + Pattern.quote(w.substring(1)) + "\\b").matcher(lower).find()
            : lower.contains(w);
    }

    private SmsParser() {}

    /** Returns null for messages that aren't payments (OTPs, offers, no amount). */
    static Result parse(String text, Map<String, String> rules) {
        String t = text == null ? "" : text.replaceAll("\\s+", " ").trim();
        if (t.isEmpty() || NOT_PAYMENT.matcher(t).find()) return null;
        Matcher amount = AMOUNT.matcher(t);
        if (!amount.find()) return null;
        long value;
        try {
            value = Math.round(Double.parseDouble(amount.group(1).replace(",", "")));
        } catch (NumberFormatException e) {
            return null;
        }
        if (value <= 0) return null;

        boolean card = HAS_CARD.matcher(t).find();
        if (card && STATEMENT.matcher(t).find() && (TOTAL_DUE.matcher(t).find() || MIN_DUE.matcher(t).find())) {
            Result r = new Result();
            r.type = "statement";
            Matcher total = TOTAL_DUE.matcher(t);
            long due = total.find() ? (long) Math.ceil(Double.parseDouble(total.group(1).replace(",", ""))) : 0;
            r.amount = due > 0 ? due : value;
            r.merchant = "Card statement";
            r.category = "Bills";
            r.last4 = last4(t);
            return r;
        }
        if (card && CARD_PAYMENT.matcher(t).find()) {
            Result r = new Result();
            r.type = "cardpayment";
            r.amount = value;
            r.merchant = "Card bill payment";
            r.category = "Bills";
            r.last4 = last4(t);
            return r;
        }

        boolean debit = DEBIT.matcher(t).find();
        boolean credit = CREDIT.matcher(t).find();
        if (!debit && !credit) return null;

        Result r = new Result();
        r.amount = value;
        r.type = debit ? "debit" : "credit";
        boolean onCard = CARD_HINT.matcher(t).find() && !DEBIT_CARD.matcher(t).find();
        r.paidFrom = onCard ? "card" : "account";
        r.last4 = onCard ? last4(t) : null;
        String merchant = findMerchant(t, debit ? DEBIT_TO : CREDIT_FROM);
        if (debit) {
            r.merchant = merchant.isEmpty() ? "Bank payment" : merchant;
            r.category = categorize(merchant.isEmpty() ? t : merchant, rules);
        } else {
            r.merchant = merchant.isEmpty() ? "Money received" : merchant;
            r.category = REFUND.matcher(t).find() ? "Refund" : "Money received";
            r.salary = SALARY.matcher(t).find();
        }
        return r;
    }

    private static String last4(String text) {
        Matcher m = CARD_LAST4.matcher(text);
        return m.find() ? m.group(1) : null;
    }

    private static String findMerchant(String text, Pattern[] patterns) {
        for (Pattern p : patterns) {
            Matcher m = p.matcher(text);
            if (m.find()) {
                String name = cleanMerchant(m.group(1));
                if (!name.isEmpty()) return name;
            }
        }
        return "";
    }

    private static String cleanMerchant(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (NOT_A_NAME.matcher(s).find()) return "";
        if (s.contains("/")) {
            List<String> parts = new ArrayList<>();
            for (String part : s.split("/")) {
                String p = part.trim();
                if (!p.isEmpty() && !p.matches("\\d+") && !p.matches("(?i)upi|p2m|p2a|imps|neft")) parts.add(p);
            }
            if (!parts.isEmpty()) s = parts.get(parts.size() - 1);
        }
        if (s.contains("@")) s = s.split("@", -1)[0].replaceAll("[._-]+", " ");
        s = s.replaceAll("\\s+", " ").replaceAll("[.,;:]+$", "").trim();
        if (s.isEmpty() || NOT_A_NAME.matcher(s).find()) return "";
        Matcher words = Pattern.compile("\\b[a-z]").matcher(s.toLowerCase(Locale.ROOT));
        StringBuffer out = new StringBuffer();
        while (words.find()) words.appendReplacement(out, words.group().toUpperCase(Locale.ROOT));
        words.appendTail(out);
        return out.length() > 40 ? out.substring(0, 40) : out.toString();
    }

    static String normalizeMerchant(String s) {
        String lower = (s == null ? "" : s).toLowerCase(Locale.ROOT).split("@", -1)[0];
        return lower.replaceAll("[^a-z0-9]+", " ").trim();
    }

    static String categorize(String text, Map<String, String> rules) {
        String key = normalizeMerchant(text);
        if (rules != null && !key.isEmpty() && rules.containsKey(key)) return rules.get(key);
        String lower = (text == null ? "" : text).toLowerCase(Locale.ROOT);
        for (String[] group : CATEGORY_KEYWORDS) {
            for (int i = 1; i < group.length; i++) {
                if (keywordMatches(lower, group[i])) return group[0];
            }
        }
        return "Misc";
    }

    /** Same as smsKey() in core.js. */
    static String key(String body) {
        String text = (body == null ? "" : body).replaceAll("\\s", "");
        int h = 5381;
        for (int i = 0; i < text.length(); i++) h = (h << 5) + h + text.charAt(i);
        return "s" + Integer.toHexString(h);
    }
}
