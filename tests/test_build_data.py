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



def make_population_xlsx(bad_header=False, units=None, total=16_000_000):
    """Tiny in-memory .xlsx with the same layout as the Ministry of Finance file."""
    import io
    import zipfile
    codes = list(units if units is not None else bd.SOURCE_PHUS)
    strings = ["YEAR (JULY 1)", "REGION CODE", "REGION NAME", "GENDER", "TOTAL", "0 to 14", "15 to 64", "65 Plus",
               "TOTAL ALL GENDERS", "MEN+", "Some Unit"]
    idx = {s: i for i, s in enumerate(strings)}
    if bad_header:
        strings[idx["65 Plus"]] = "Seniors"

    def sc(ref, s):
        return '<c r="%s" t="s"><v>%d</v></c>' % (ref, idx[s])

    rows = ['<row r="5">' + sc("A5", "YEAR (JULY 1)") + sc("B5", "REGION CODE") + sc("C5", "REGION NAME") + sc("D5", "GENDER")
            + sc("E5", "TOTAL") + sc("F5", "0 to 14") + sc("G5", "15 to 64") + sc("H5", "65 Plus") + "</row>"]
    each = total // 34
    for i, code in enumerate(codes, start=6):
        rows.append('<row r="%d"><c r="A%d"><v>%d</v></c><c r="B%d"><v>%d</v></c>%s%s<c r="E%d"><v>%d</v></c>'
                    '<c r="F%d"><v>%d</v></c><c r="G%d"><v>0</v></c><c r="H%d"><v>%d</v></c></row>'
                    % (i, i, bd.POP_YEAR, i, code, sc("C%d" % i, "Some Unit"), sc("D%d" % i, "TOTAL ALL GENDERS"),
                       i, each, i, each // 10, i, i, each // 5))
    rows.append('<row r="900"><c r="A900"><v>%d</v></c><c r="B900"><v>2226</v></c>%s<c r="E900"><v>5</v></c></row>'
                % (bd.POP_YEAR, sc("D900", "MEN+")))  # a non-total row that must be ignored
    sheet = '<worksheet><sheetData>%s</sheetData></worksheet>' % "".join(rows)
    sst = "<sst>%s</sst>" % "".join("<si><t>%s</t></si>" % s for s in strings)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/sharedStrings.xml", sst)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


class PopulationTests(unittest.TestCase):
    def test_parse_and_merge(self):
        pop = bd.parse_population(make_population_xlsx())
        self.assertEqual(pop["year"], bd.POP_YEAR)
        self.assertEqual(sorted(pop["per_phu"]), sorted(str(i) for i in bd.CURRENT_PHUS))
        each = 16_000_000 // 34
        self.assertEqual(pop["per_phu"]["2226"]["pop"], each)
        self.assertEqual(pop["per_phu"]["7652"]["pop"], 2 * each)      # Brant + Haldimand-Norfolk
        self.assertEqual(pop["per_phu"]["7655"]["pop"], 3 * each)      # three units merged into Southeast
        self.assertAlmostEqual(pop["ON"]["pct65"], 20.0, places=1)

    def test_bad_header_rejected(self):
        with self.assertRaises(bd.ValidationError):
            bd.parse_population(make_population_xlsx(bad_header=True))

    def test_missing_unit_rejected(self):
        with self.assertRaises(bd.ValidationError):
            bd.parse_population(make_population_xlsx(units=list(bd.SOURCE_PHUS)[:-1]))

    def test_implausible_total_rejected(self):
        with self.assertRaises(bd.ValidationError):
            bd.parse_population(make_population_xlsx(total=1_000_000))

    def test_not_an_excel_file_rejected(self):
        with self.assertRaises(bd.ValidationError):
            bd.parse_population(b"<html>not excel</html>")


class AgeGroupTests(unittest.TestCase):
    def test_masking_capping_and_merging(self):
        ids = sorted(bd.CURRENT_PHUS)
        age = {(2226, "80+"): [3.0, 900.0, 950.0, 1000.0],       # 3 people with a dose -> masked
               (2230, "80+"): [1200.0, 800.0, 100.0, 1000.0]}    # over 100% of the 2021 population -> capped
        out = bd.build_age_vax(dt.date(2024, 11, 6), age, ids)
        g = out["groups"].index("80+")
        self.assertIsNone(out["series"]["2226"]["dose1"][g])
        self.assertEqual(out["series"]["2226"]["full"][g], 90.0)
        self.assertEqual(out["series"]["2230"]["dose1"][g], 100.0)
        self.assertEqual(out["series"]["2230"]["dose3"][g], 10.0)
        self.assertIsNone(out["series"]["2253"]["dose1"][g])       # no population -> no value
        self.assertEqual(out["date"], "2024-11-06")

    def test_document_validation_covers_new_blocks(self):
        doc = bd.build_synthetic(today=dt.date(2025, 1, 15))
        ids = sorted(bd.CURRENT_PHUS)
        age = {(pid, g): [500.0, 400.0, 300.0, 1000.0] for pid in ids for _, g in bd.AGE_GROUPS}
        doc["age_vax"] = bd.build_age_vax(dt.date(2025, 1, 15), age, ids)
        doc["context"] = bd.parse_population(make_population_xlsx())
        self.assertEqual(bd.validate_document(doc), [])
        bad = copy.deepcopy(doc)
        bad["age_vax"]["series"]["ON"]["dose1"][0] = 250
        self.assertTrue(bd.validate_document(bad))
        bad = copy.deepcopy(doc)
        bad["context"]["ON"]["pop"] = 5
        self.assertTrue(bd.validate_document(bad))
        bad = copy.deepcopy(doc)
        del bad["context"]["per_phu"]["3895"]
        self.assertTrue(bd.validate_document(bad))


if __name__ == "__main__":
    unittest.main()
