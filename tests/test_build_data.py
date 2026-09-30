import copy
import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_data as bd  # noqa: E402


def make_testing_csv(days=400, drop_column=None, bad_name=False, negative=False, tiny=False, override=None):
    """Small but structurally valid testing CSV covering every known PHU plus the Ontario row."""
    cols = ["DATE", "PHU_num", "PHU_name", "percent_positive_7d_avg", "test_volumes_7d_avg",
            "tests_per_1000_7d_avg", "percent_complete_nextday_7d_avg", "percent_complete_2days_7d_avg"]
    if drop_column:
        cols.remove(drop_column)
    lines = [",".join(cols)]
    start = dt.date(2023, 1, 4)
    for i in range(days):
        d = (start + dt.timedelta(days=i)).isoformat()
        rows = [(35, "Ontario", 0.10, 5000)]
        for pid, (name, _) in bd.SOURCE_PHUS.items():
            rows.append((pid, name, 0.10, 100))
        for pid, name, pct, vol in rows:
            if bad_name and pid == 2226:
                name = "Some Other Health Unit"
            if negative and pid == 2226 and i == 3:
                pct = -0.1
            if tiny and pid == 2226 and i == 0:
                vol = 3
            if override and pid in override:
                pct, vol = override[pid]
            row = {"DATE": d, "PHU_num": pid, "PHU_name": '"%s"' % name, "percent_positive_7d_avg": pct,
                   "test_volumes_7d_avg": '"%s"' % format(vol, ","), "tests_per_1000_7d_avg": 1,
                   "percent_complete_nextday_7d_avg": 1, "percent_complete_2days_7d_avg": 1}
            lines.append(",".join(str(row[c]) for c in cols))
    return "\n".join(lines) + "\n"


def make_vaccine_csv(days=400):
    cols = ["Date", "PHU ID", "PHU name", "Agegroup", "At least one dose_cumulative", "Second_dose_cumulative",
            "fully_vaccinated_cumulative", "third_dose_cumulative", "Total population",
            "Percent_at_least_one_dose", "Percent_fully_vaccinated", "Percent_3doses"]
    lines = [",".join('"%s"' % c for c in cols)]
    start = dt.date(2023, 1, 4)
    for i in range(days):
        d = (start + dt.timedelta(days=i)).isoformat()
        for pid, (_, name) in bd.SOURCE_PHUS.items():
            lines.append('%s,%d,"%s","Ontario_5plus",800,700,700,400,1000,.8,.7,.4' % (d, pid, name))
    return "\n".join(lines) + "\n"


class SuppressionTests(unittest.TestCase):
    def test_small_counts_masked(self):
        for v in (1, 2, 3, 4, 4.9):
            self.assertIsNone(bd.suppress_small_count(v), v)

    def test_boundary_and_large_pass(self):
        self.assertEqual(bd.suppress_small_count(5), 5)
        self.assertEqual(bd.suppress_small_count(1093), 1093)

    def test_zero_and_none_pass_through(self):
        self.assertEqual(bd.suppress_small_count(0), 0)
        self.assertIsNone(bd.suppress_small_count(None))

    def test_small_volume_hidden_in_output(self):
        # tiny volume (3) on the first date for a single unit must not be published
        old = bd.MIN_TESTING_ROWS, bd.MIN_VACCINE_ROWS
        bd.MIN_TESTING_ROWS = bd.MIN_VACCINE_ROWS = 1
        try:
            doc = bd.build_document(make_testing_csv(tiny=True), make_vaccine_csv(), today=dt.date(2024, 1, 1))
        finally:
            bd.MIN_TESTING_ROWS, bd.MIN_VACCINE_ROWS = old
        s = doc["series"]["2226"]
        self.assertIsNone(s["vol"][0])
        self.assertIsNone(s["pos"][0])
        self.assertIsNotNone(s["vol"][1])


class ParsingTests(unittest.TestCase):
    def test_parse_number(self):
        self.assertEqual(bd.parse_number("1,093"), 1093.0)
        self.assertEqual(bd.parse_number(".2743"), 0.2743)
        self.assertIsNone(bd.parse_number(""))
        with self.assertRaises(ValueError):
            bd.parse_number("abc")

    def test_week_grid_steps_back_from_latest(self):
        dates = [dt.date(2024, 1, 1) + dt.timedelta(days=i) for i in range(30)]
        grid = bd.week_grid(dates)
        self.assertEqual(grid[-1], dates[-1])
        self.assertTrue(all((b - a).days == 7 for a, b in zip(grid, grid[1:])))
        self.assertGreaterEqual(grid[0], dates[0])

    def test_missing_column_raises(self):
        with self.assertRaises(bd.ValidationError) as cm:
            bd.parse_testing(make_testing_csv(days=2, drop_column="test_volumes_7d_avg"))
        self.assertIn("test_volumes_7d_avg", str(cm.exception))

    def test_unknown_phu_name_raises(self):
        with self.assertRaises(bd.ValidationError):
            bd.parse_testing(make_testing_csv(days=2, bad_name=True))

    def test_negative_or_implausible_number_raises(self):
        with self.assertRaises(bd.ValidationError):
            bd.parse_testing(make_testing_csv(days=6, negative=True))

    def test_too_few_rows_raises(self):
        with self.assertRaises(bd.ValidationError) as cm:
            bd.build_document(make_testing_csv(days=3), make_vaccine_csv(days=3))
        self.assertIn("suspiciously" if "suspiciously" in str(cm.exception) else "rows", str(cm.exception))


class MergeTests(unittest.TestCase):
    def test_merged_units_use_weighted_rate_not_average(self):
        old = bd.MIN_TESTING_ROWS, bd.MIN_VACCINE_ROWS
        bd.MIN_TESTING_ROWS = bd.MIN_VACCINE_ROWS = 1
        try:
            csv_text = make_testing_csv(days=10, override={2234: (0.5, 300), 35: (0.48 / 3.6, 3600)})  # Haldimand-Norfolk: 300 tests at 50%; keep Ontario row consistent
            doc = bd.build_document(csv_text, make_vaccine_csv(days=10), today=dt.date(2024, 1, 1))
        finally:
            bd.MIN_TESTING_ROWS, bd.MIN_VACCINE_ROWS = old
        grand_erie = doc["series"]["7652"]
        self.assertAlmostEqual(grand_erie["pos"][-1], 100 * (0.1 * 100 + 0.5 * 300) / 400, places=2)
        self.assertEqual(grand_erie["vol"][-1], 400)


class DocumentValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = bd.build_synthetic(today=dt.date(2025, 1, 15))

    def fresh(self):
        return copy.deepcopy(self.doc)

    def test_valid_document_passes(self):
        self.assertEqual(bd.validate_document(self.fresh()), [])

    def test_negative_number_fails(self):
        d = self.fresh()
        d["series"]["2226"]["pos"][5] = -1
        self.assertTrue(any("negative" in e for e in bd.validate_document(d)))

    def test_percentage_over_100_fails(self):
        d = self.fresh()
        d["series"]["ON"]["vax1"][3] = 140
        self.assertTrue(bd.validate_document(d))

    def test_unknown_phu_fails(self):
        d = self.fresh()
        d["phus"][0]["name"] = "Made Up Health Unit"
        self.assertTrue(bd.validate_document(d))

    def test_missing_phu_fails(self):
        d = self.fresh()
        d["phus"].pop()
        self.assertTrue(bd.validate_document(d))

    def test_wrong_length_series_fails(self):
        d = self.fresh()
        d["series"]["2226"]["pos"].pop()
        self.assertTrue(any("wrong length" in e for e in bd.validate_document(d)))

    def test_too_few_dates_fails(self):
        d = self.fresh()
        d["dates"] = d["dates"][:3]
        self.assertTrue(bd.validate_document(d))

    def test_unmasked_small_count_fails(self):
        d = self.fresh()
        d["series"]["2226"]["vol"][2] = 3
        self.assertTrue(any("small count" in e for e in bd.validate_document(d)))

    def test_older_data_than_existing_fails(self):
        existing = self.fresh()
        new = self.fresh()
        existing["meta"]["latest_data_date"] = "2099-01-01"
        self.assertTrue(any("older" in e for e in bd.validate_document(new, existing)))

    def test_equal_date_is_allowed(self):
        self.assertEqual(bd.validate_document(self.fresh(), self.fresh()), [])

    def test_synthetic_cannot_replace_real(self):
        existing = self.fresh()
        existing["meta"]["synthetic"] = False
        self.assertTrue(any("synthetic" in e for e in bd.validate_document(self.fresh(), existing)))

    def test_same_payload_ignores_download_date(self):
        a, b = self.fresh(), self.fresh()
        b["meta"]["downloaded"] = "2030-01-01"
        self.assertTrue(bd.same_payload(a, b))
        b["series"]["ON"]["pos"][0] += 1
        self.assertFalse(bd.same_payload(a, b))


class FailureLeavesFileUntouchedTests(unittest.TestCase):
    def test_bad_input_keeps_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "data.json"
            good = bd.build_synthetic(today=dt.date(2025, 1, 15))
            out.write_text(json.dumps(good), encoding="utf-8")
            before = out.read_bytes()
            bad_csv = Path(tmp) / "bad.csv"
            bad_csv.write_text("a,b\n1,2\n", encoding="utf-8")
            code = bd.main(["--out", str(out), "--testing-file", str(bad_csv), "--vaccine-file", str(bad_csv)])
            self.assertEqual(code, 1)
            self.assertEqual(out.read_bytes(), before)

    def test_synthetic_refuses_data_json(self):
        self.assertEqual(bd.main(["--synthetic"]), 1)


if __name__ == "__main__":
    unittest.main()
