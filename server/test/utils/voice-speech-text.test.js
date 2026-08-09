const { expect } = require('chai');

const {
  CODE_PLACEHOLDER,
  CUT_NOTICE,
  TABLE_PLACEHOLDER,
  cutSpeechText,
  hasSpeakableContent,
  stripMarkdown,
} = require('../../utils/voice-speech-text');

// The table cases below are the SAME INPUTS setl's data/core/tts/table_test.go
// (TestNarrateTable) feeds its narrator, with the same expectations, because
// that narrator is what this module was ported from and the claim being made
// is that a table is read out the same way by both. Change one side and change
// the other — a case that fails here is either a port defect or a decision
// somebody made on one side only.
describe('voice-speech-text', () => {
  describe('#stripMarkdown(markdown)', () => {
    it('should give a heading a sentence stop rather than speaking its hashes', () => {
      expect(stripMarkdown('## Summary\nThe job ran.')).to.equal('Summary.\nThe job ran.');
      expect(stripMarkdown('### Done ###')).to.equal('Done.');
      // A heading with punctuation of its own keeps just the one.
      expect(stripMarkdown('# Ready?')).to.equal('Ready?');
    });

    it('should underline a setext heading into a stop and drop the rule', () => {
      expect(stripMarkdown('Summary\n===\nText.')).to.equal('Summary.\nText.');
      expect(stripMarkdown('Summary\n---\nText.')).to.equal('Summary.\nText.');
    });

    it('should drop a thematic break', () => {
      expect(stripMarkdown('One.\n\n***\n\nTwo.')).to.equal('One.\n\nTwo.');
      expect(stripMarkdown('One.\n\n- - -\n\nTwo.')).to.equal('One.\n\nTwo.');
      // Not a break — mixed markers, and only two of them. (`*-*` is not a
      // useful counter-example here: it is emphasis, and the inline pass turns
      // it into `-` on both sides of the port.)
      expect(stripMarkdown('a -_- b')).to.equal('a -_- b');
      expect(stripMarkdown('--')).to.equal('--');
    });

    it('should replace a fenced code block with a placeholder, not read it out', () => {
      expect(stripMarkdown('Here:\n\n```js\nconst a = 1;\n```\n\nDone.')).to.equal(
        `Here:\n\n${CODE_PLACEHOLDER}\n\nDone.`,
      );
      // ~~~ fences too, and a ``` inside one does not close it.
      expect(stripMarkdown('~~~\n```\nstill code\n~~~\nAfter.')).to.equal(
        `${CODE_PLACEHOLDER}\nAfter.`,
      );
      // An unclosed fence swallows the rest, which is right: the rest is code.
      expect(stripMarkdown('Text.\n```\nconst a = 1;')).to.equal(`Text.\n${CODE_PLACEHOLDER}`);
      // A fence nested two list levels deep is still a fence.
      expect(stripMarkdown('- outer\n  - inner:\n\n    ```json\n    {}\n    ```')).to.equal(
        `outer\ninner:\n\n${CODE_PLACEHOLDER}`,
      );
    });

    it('should strip inline constructs but keep what they said', () => {
      expect(stripMarkdown('**bold** and _italic_ and `code`')).to.equal(
        'bold and italic and code',
      );
      expect(stripMarkdown('See [the card](https://example.com/c/1).')).to.equal('See the card.');
      expect(stripMarkdown('![a chart](https://example.com/c.png)')).to.equal('a chart');
      expect(stripMarkdown('See [the card][ref].')).to.equal('See the card.');
      expect(stripMarkdown('<https://example.com/x>')).to.equal('https://example.com/x');
      expect(stripMarkdown('~~gone~~ text')).to.equal('gone text');
    });

    it('should leave snake_case alone', () => {
      // Underscore emphasis with no boundaries would eat the underscores out of
      // every field name in the product and speak it as one word.
      expect(stripMarkdown('the snake_case_name field')).to.equal('the snake_case_name field');
      expect(stripMarkdown('_a_ and _b_')).to.equal('a and b');
    });

    it('should keep an escaped markdown character as the character', () => {
      expect(stripMarkdown('\\*star\\*')).to.equal('*star*');
      expect(stripMarkdown('2 \\* 3')).to.equal('2 * 3');
    });

    it('should remove HTML tags but keep a < > pair that is not markup', () => {
      expect(stripMarkdown('a <b>bold</b> word')).to.equal('a bold word');
      expect(stripMarkdown('balance<threshold and days>30')).to.equal(
        'balance<threshold and days>30',
      );
      expect(stripMarkdown('put it in <path>')).to.equal('put it in <path>');
    });

    it('should see the construct inside a blockquote', () => {
      // The marker comes off before the block loop, or a quoted heading is read
      // out with its hashes.
      expect(stripMarkdown('> ## Quoted\n> text')).to.equal('Quoted.\ntext');
      expect(stripMarkdown('> > deep')).to.equal('deep');
    });

    it('should drop list markers', () => {
      expect(stripMarkdown('- one\n- two')).to.equal('one\ntwo');
      expect(stripMarkdown('1. one\n2) two')).to.equal('one\ntwo');
    });

    it('should narrate a figures table row by row', () => {
      expect(
        stripMarkdown(
          '| Merchant | Volume | Fees |\n|---|---:|---:|\n| Acme | 1,234.56 | 12.34 |\n| Globex | 987.65 | 9.88 |',
        ),
      ).to.equal(
        'A table of 2 rows comparing Volume and Fees by Merchant. ' +
          'Acme: Volume 1,234.56, Fees 12.34. Globex: Volume 987.65, Fees 9.88.',
      );
    });

    it('should drop the repeated column label on a metric/value summary', () => {
      expect(
        stripMarkdown(
          '| Metric | Value |\n|---|---|\n| Sum | 1,204,331.20 |\n| Avg | 61.74 |\n| StdDev | 892.13 |',
        ),
      ).to.equal(
        'A table of 3 rows comparing Value by Metric. Sum: 1,204,331.20. Avg: 61.74. StdDev: 892.13.',
      );
    });

    it('should number the rows of a table that is nothing but figures', () => {
      expect(stripMarkdown('| Q1 | Q2 | Q3 |\n|---|---|---|\n| 10 | 20 | 30 |\n| 11 | 21 | 31 |')).to.equal(
        'A table of 2 rows with columns Q1, Q2 and Q3. ' +
          'Row 1: Q1 10, Q2 20, Q3 30. Row 2: Q1 11, Q2 21, Q3 31.',
      );
    });

    it('should read a year or an ISO month column as a subject', () => {
      expect(
        stripMarkdown('| Year | Revenue |\n|---|---|\n| 2023 | 100 |\n| 2024 | 120 |\n| Total | 220 |'),
      ).to.equal('A table of 3 rows comparing Revenue by Year. 2023: 100. 2024: 120. Total: 220.');

      expect(
        stripMarkdown('| Month | Settled |\n|---|---|\n| 2024-01 | 4,120 |\n| 2024-02 | 3,980 |'),
      ).to.equal('A table of 2 rows comparing Settled by Month. 2024-01: 4,120. 2024-02: 3,980.');
    });

    it('should keep a four-digit count outside the calendar range a measure', () => {
      expect(stripMarkdown('| 8801 | 8802 |\n|---|---|\n| 9100 | 9200 |')).to.equal(
        'A table of 1 row with columns 8801 and 8802. Row 1: 8801 9100, 8802 9200.',
      );
    });

    it('should read a one-column table out as the list it is', () => {
      expect(stripMarkdown('| Merchant |\n|---|\n| Acme |\n| Globex |\n| Initech |')).to.equal(
        'A table of Merchant: Acme, Globex and Initech.',
      );
    });

    it('should say so for a header with no rows', () => {
      expect(stripMarkdown('| Source | Rows |\n|---|---|')).to.equal(
        'An empty table with columns Source and Rows.',
      );
    });

    it('should skip blank cells rather than speak them as gaps', () => {
      expect(
        stripMarkdown('| Source | Rows | Errors |\n|---|---|---|\n| VIRTPAY | 2043 |  |'),
      ).to.equal('A table of 1 row comparing Rows and Errors by Source. VIRTPAY: Rows 2043.');
    });

    it('should keep the subject of a row whose values are all blank', () => {
      expect(
        stripMarkdown('| Source | Rows |\n|---|---|\n| VIRTPAY | 2043 |\n| CSP |  |'),
      ).to.equal('A table of 2 rows comparing Rows by Source. VIRTPAY: 2043. CSP.');

      // endSentence, not a bare ".": "Acme:." makes the voice pause twice on a
      // row that said nothing.
      expect(
        stripMarkdown('| Source | Rows |\n|---|---|\n| VIRTPAY | 2043 |\n| Acme: |  |'),
      ).to.equal('A table of 2 rows comparing Rows by Source. VIRTPAY: 2043. Acme:');
    });

    it('should keep the values of a row wider than its header', () => {
      expect(stripMarkdown('| Source | Rows |\n|---|---|\n| VIRTPAY | 2043 | 7 |')).to.equal(
        'A table of 1 row comparing Rows by Source. VIRTPAY: 2043, 7.',
      );
    });

    it('should narrate what a short row has', () => {
      expect(
        stripMarkdown('| Source | Rows | Errors |\n|---|---|---|\n| VIRTPAY | 2043 |'),
      ).to.equal('A table of 1 row comparing Rows and Errors by Source. VIRTPAY: Rows 2043.');
    });

    it('should let an unnamed first column still name its rows', () => {
      expect(stripMarkdown('|  | Q1 |\n|---|---|\n| Revenue | 10 |')).to.equal(
        'A table of 1 row comparing Q1. Revenue: 10.',
      );

      expect(
        stripMarkdown(
          '|  | Sum | Avg |\n|---|---|---|\n| amount | 58,123,626 | 72.45 |\n' +
            '| totalMerchantFee | 2,607,792 | 3.25 |\n| netAmountToMerchant | 45,870,379 | 57.18 |',
        ),
      ).to.equal(
        'A table of 3 rows comparing Sum and Avg. ' +
          'amount: Sum 58,123,626, Avg 72.45. ' +
          'totalMerchantFee: Sum 2,607,792, Avg 3.25. ' +
          'netAmountToMerchant: Sum 45,870,379, Avg 57.18.',
      );
    });

    it('should number a row that has no subject of its own', () => {
      expect(
        stripMarkdown('| Merchant | Volume |\n|---|---|\n| Acme | 10 |\n| Globex | 15 |\n|  | 20 |'),
      ).to.equal('A table of 3 rows comparing Volume by Merchant. Acme: 10. Globex: 15. Row 3: 20.');
    });

    it('should handle a table whose measure columns are all unnamed', () => {
      expect(stripMarkdown('| Metric |  |\n|---|---|\n| Sum | 10 |\n| Avg | 2.5 |')).to.equal(
        'A table of 2 rows of Metric. Sum: 10. Avg: 2.5.',
      );
    });

    it('should narrate a non-latin table rather than dropping its data', () => {
      expect(stripMarkdown('| Мерчант | Объём |\n|---|---|\n| Акме | 1 204 |')).to.equal(
        'A table of 1 row comparing Объём by Мерчант. Акме: 1 204.',
      );
    });

    it('should announce the tail of a table past the row cap', () => {
      const rows = Array.from({ length: 24 }, (_, index) => `| m${index} | ${index} |`).join('\n');
      const spoken = stripMarkdown(`| Merchant | Volume |\n|---|---|\n${rows}`);

      expect(spoken).to.match(/^A table of 24 rows comparing Volume by Merchant\./);
      expect(spoken).to.contain('m19: 19.');
      expect(spoken).to.not.contain('m20:');
      expect(spoken).to.contain('And 4 more rows.');
    });

    it('should fall back to a placeholder for a table block with no usable cells', () => {
      expect(stripMarkdown('|  |  |\n|---|---|\n|  |  |')).to.equal(TABLE_PLACEHOLDER);
    });

    it('should leave a pipe in prose alone', () => {
      expect(stripMarkdown('use a | b to pipe')).to.equal('use a | b to pipe');
    });
  });

  describe('#hasSpeakableContent(text)', () => {
    it('should be true for anything with a letter or a digit in it', () => {
      expect(hasSpeakableContent('hello')).to.equal(true);
      expect(hasSpeakableContent('42')).to.equal(true);
      // The placeholders deliberately contain words, because a message that was
      // nothing but a code block reduces to one.
      expect(hasSpeakableContent(CODE_PLACEHOLDER)).to.equal(true);
      expect(hasSpeakableContent('Объём')).to.equal(true);
    });

    it('should be false for punctuation, whitespace and nothing', () => {
      expect(hasSpeakableContent('###')).to.equal(false);
      expect(hasSpeakableContent('   ')).to.equal(false);
      expect(hasSpeakableContent('')).to.equal(false);
      expect(hasSpeakableContent(undefined)).to.equal(false);
    });
  });

  describe('#cutSpeechText(text, maxChars)', () => {
    it('should leave text inside the ceiling exactly as it was', () => {
      expect(cutSpeechText('Short enough.', 100)).to.equal('Short enough.');
      expect(cutSpeechText('No ceiling at all.', 0)).to.equal('No ceiling at all.');
    });

    it('should cut at the last sentence and say the rest is on screen', () => {
      const text = 'One sentence. Two sentences. Three sentences.';
      const cut = cutSpeechText(text, 30);

      expect(cut).to.equal(`One sentence. Two sentences. ${CUT_NOTICE}`);
    });

    it('should cut at a word when there is no sentence boundary to find', () => {
      const cut = cutSpeechText('aaaa bbbb cccc dddd eeee', 12);

      expect(cut).to.equal(`aaaa bbbb ${CUT_NOTICE}`);
      expect(cut).to.not.contain('cccc');
    });

    it('should measure code points, so an emoji does not shorten the cut', () => {
      // Ten code points, twenty UTF-16 units: a ceiling of 10 must not cut it.
      const emoji = '😀'.repeat(10);

      expect(cutSpeechText(emoji, 10)).to.equal(emoji);
      expect(cutSpeechText(emoji, 9)).to.contain(CUT_NOTICE);
    });
  });
});
