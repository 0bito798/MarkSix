import unittest

import marksix_local


class MarkovStrategyTests(unittest.TestCase):
    def setUp(self):
        self.draws = [
            [1, 2, 3, 4, 5, 6],
            [42, 10, 11, 12, 13, 14],
            [7, 15, 16, 17, 18, 19],
            [42, 20, 21, 22, 23, 24],
            [7, 25, 26, 27, 28, 29],
            [42, 30, 31, 32, 33, 34],
            [7, 35, 36, 37, 38, 39],
        ]
        self.specials = [7, 40, 7, 41, 7, 43, 7]

    def _seed_history(self, conn):
        for index in range(1, 26):
            numbers = [((index + offset - 1) % 49) + 1 for offset in range(6)]
            record = marksix_local.DrawRecord(
                issue_no=f"2026{index:03d}",
                draw_date=f"2026-01-{index:02d}",
                numbers=numbers,
                special_number=((index + 10) % 49) + 1,
            )
            marksix_local.upsert_draw(conn, record, "test")
        conn.commit()

    def test_markov_is_not_part_of_default_strategy_ids(self):
        self.assertNotIn("markov_v1", marksix_local.STRATEGY_IDS)
        self.assertIn("markov_v1", marksix_local.STRATEGY_LABELS)

    def test_markov_scores_favor_observed_followers(self):
        scores = marksix_local._markov_score_map(self.draws, specials=self.specials)
        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)

        self.assertEqual(ranked[0][0], 42)
        self.assertGreater(scores[42], scores[10])

    def test_markov_profile_uses_second_order_sources(self):
        draws = [
            [8, 1, 2, 3, 4, 5],
            [7, 6, 9, 10, 11, 12],
            [30, 13, 14, 15, 16, 17],
            [8, 18, 19, 20, 21, 22],
            [7, 23, 24, 25, 26, 27],
            [30, 28, 29, 31, 32, 33],
            [8, 34, 35, 36, 37, 38],
            [7, 39, 40, 41, 42, 43],
        ]
        specials = [8, 7, 30, 8, 7, 30, 8, 7]

        profile = marksix_local._markov_transition_profile(draws, specials=specials)

        self.assertGreater(profile["second_order_scores"][30], profile["second_order_scores"][31])
        self.assertGreaterEqual(profile["attribute_scores"][30], 0.0)

    def test_generate_strategy_supports_markov_v1(self):
        picks, special_number, special_score, score_map = marksix_local.generate_strategy(
            self.draws,
            "markov_v1",
            specials=self.specials,
        )

        main_numbers = [number for number, _, _, _ in picks]
        self.assertEqual(len(main_numbers), 6)
        self.assertEqual(len(set(main_numbers)), 6)
        self.assertTrue(all(1 <= number <= 49 for number in main_numbers))
        self.assertTrue(1 <= special_number <= 49)
        self.assertNotIn(special_number, main_numbers)
        self.assertEqual(len(score_map), 49)
        self.assertGreaterEqual(special_score, 0.0)

    def test_generate_predictions_can_create_only_markov_strategy(self):
        conn = marksix_local.connect_db(":memory:")
        try:
            marksix_local.init_db(conn)
            self._seed_history(conn)

            issue = marksix_local.generate_predictions(conn, strategy_ids=["markov_v1"])
            rows = conn.execute(
                "SELECT strategy FROM prediction_runs WHERE issue_no = ? ORDER BY strategy",
                (issue,),
            ).fetchall()

            self.assertEqual([row["strategy"] for row in rows], ["markov_v1"])
        finally:
            conn.close()

    def test_default_prediction_generation_does_not_create_markov_strategy(self):
        conn = marksix_local.connect_db(":memory:")
        try:
            marksix_local.init_db(conn)
            self._seed_history(conn)

            issue = marksix_local.generate_predictions(conn)
            rows = conn.execute(
                "SELECT strategy FROM prediction_runs WHERE issue_no = ? ORDER BY strategy",
                (issue,),
            ).fetchall()
            strategies = [row["strategy"] for row in rows]

            self.assertEqual(strategies, sorted(marksix_local.STRATEGY_IDS))
            self.assertNotIn("markov_v1", strategies)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
