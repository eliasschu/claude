from pathlib import Path

import pytest

from quant.sec.form4 import classify, parse_form4
from quant.sec.xml import SecParseError

FIX = Path(__file__).parent / "fixtures"


def test_parses_and_classifies_with_footnote_context():
    f = parse_form4((FIX / "form4_ceo_buy.xml").read_text())
    assert f.issuer_cik == "320193" and f.issuer_ticker == "TST" and f.owners[0].roles[:1] == ("CEO",)
    assert "DIRECTOR" in f.owners[0].roles and f.plan_10b5_1_flag is False
    buy, sale, gift, exercise = f.transactions
    assert buy.classification == "OPEN_MARKET_BUY" and buy.discretionary and buy.shares == 10_000 and buy.value == pytest.approx(521_000)
    assert "weighted_average" in buy.context and buy.classification_confidence >= 0.9
    # Verkauf nach Vesting zur Steuerdeckung ist KEIN freiwilliger Verkauf
    assert sale.code == "S" and sale.classification == "TAX_WITHHOLDING" and not sale.discretionary and "sell_to_cover_tax" in sale.context
    assert gift.classification == "GIFT" and gift.ownership == "I" and gift.nature_of_ownership == "By Family Trust"
    assert exercise.classification == "OPTION_EXERCISE" and exercise.table == "derivative" and exercise.exercise_price == 20.0


@pytest.mark.parametrize("code,table,ctx,plan,expected,disc", [
    ("P", "non_derivative", set(), False, "OPEN_MARKET_BUY", True),
    ("P", "non_derivative", {"plan_10b5_1"}, False, "OPEN_MARKET_BUY", False),
    ("P", "non_derivative", {"drip"}, False, "OPEN_MARKET_BUY", False),
    ("S", "non_derivative", set(), True, "OPEN_MARKET_SELL", False),
    ("S", "non_derivative", set(), False, "OPEN_MARKET_SELL", True),
    ("F", "non_derivative", set(), False, "TAX_WITHHOLDING", False),
    ("A", "non_derivative", set(), False, "AWARD", False),
    ("A", "derivative", set(), False, "GRANT", False),
    ("C", "derivative", set(), False, "CONVERSION", False),
    ("W", "non_derivative", set(), False, "TRANSFER", False),
    ("J", "non_derivative", {"trust_transfer"}, False, "TRANSFER", False),
    ("J", "non_derivative", set(), False, "OTHER", False),
])
def test_classification_table(code, table, ctx, plan, expected, disc):
    cls, conf, d, _ = classify(code, table, None, ctx, plan)
    assert cls == expected and d == disc and 0 < conf <= 1


def test_corrupt_or_wrong_document_raises_parse_error():
    with pytest.raises(SecParseError):
        parse_form4("<ownershipDocument><issuer>")
    with pytest.raises(SecParseError):
        parse_form4("<informationTable/>")
    with pytest.raises(SecParseError):
        parse_form4("<ownershipDocument><issuer/></ownershipDocument>")  # Pflichtfeld fehlt
