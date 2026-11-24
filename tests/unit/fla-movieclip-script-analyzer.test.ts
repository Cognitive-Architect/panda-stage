import { describe, expect, it } from 'vitest';
import {
  analyzeMovieClipFrameScript,
  extractFlaXflScriptText,
  resolveMovieClipPlayheadFrame,
} from '../../src/main/services/fla-movieclip-script-analyzer';

describe('fla-movieclip-script-analyzer', () => {
  describe('analyzeMovieClipFrameScript', () => {
    it('recognizes unconditional self stop() and this.stop()', () => {
      expect(analyzeMovieClipFrameScript('stop()')).toBe('stop');
      expect(analyzeMovieClipFrameScript('stop();')).toBe('stop');
      expect(analyzeMovieClipFrameScript('this.stop()')).toBe('stop');
      expect(analyzeMovieClipFrameScript('this.stop();')).toBe('stop');
      expect(analyzeMovieClipFrameScript('  /* hold pose */ this . stop ( ) ; // end\n')).toBe('stop');
      expect(analyzeMovieClipFrameScript('trace("reached end");\nstop();')).toBe('stop');
      expect(analyzeMovieClipFrameScript('trace("done")\nthis.stop()')).toBe('stop');
      expect(analyzeMovieClipFrameScript(';stop();;')).toBe('stop');
    });

    it('classifies empty, comment-only, and literal trace scripts as harmless', () => {
      expect(analyzeMovieClipFrameScript('')).toBe('harmless');
      expect(analyzeMovieClipFrameScript('   \r\n\t  ')).toBe('harmless');
      expect(analyzeMovieClipFrameScript(';;')).toBe('harmless');
      expect(analyzeMovieClipFrameScript('// stop();')).toBe('harmless');
      expect(analyzeMovieClipFrameScript('/* stop(); this.stop(); */')).toBe('harmless');
      expect(analyzeMovieClipFrameScript('trace();')).toBe('harmless');
      expect(analyzeMovieClipFrameScript('trace("stop()");')).toBe('harmless');
      expect(analyzeMovieClipFrameScript("trace('this.stop()');")).toBe('harmless');
      expect(analyzeMovieClipFrameScript('trace("frame", 2, -1.5, true, false, null, undefined);')).toBe('harmless');
      expect(analyzeMovieClipFrameScript('trace("f" + 1 + " ok")\ntrace("next")')).toBe('harmless');
    });

    it('rejects uncalled function bodies, callbacks, other objects, conditionals, jumps, and mixed scripts', () => {
      expect(analyzeMovieClipFrameScript('function helper() { stop(); }')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('btn.addEventListener("click", function() { stop(); });')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('other.stop();')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('this.child.stop();')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('_parent.stop();')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('if (done) stop();')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('if (x > 0) { stop(); }')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('ready && stop();')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('flag ? stop() : play();')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('gotoAndStop(1);')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('gotoAndPlay(2);')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('play();')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('nextFrame();')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('prevFrame();')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('stop(1);')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('stop(); gotoAndPlay(1);')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('trace(stop());')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('trace(frameIndex);')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('stop() + 1;')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('stop()\n.foo()')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('/* unterminated')).toBe('unsupported');
      expect(analyzeMovieClipFrameScript('trace("unterminated);')).toBe('unsupported');
    });
  });

  describe('extractFlaXflScriptText', () => {
    it('extracts CDATA, XML-encoded text, and self-closing script blocks', () => {
      expect(extractFlaXflScriptText('<script><![CDATA[stop();]]></script>')).toBe('stop();');
      expect(extractFlaXflScriptText('<script>trace(&quot;a &amp; b&quot;);</script>')).toBe('trace("a & b");');
      expect(extractFlaXflScriptText('<script>trace(&amp;lt;x&amp;gt;);</script>')).toBe('trace(&lt;x&gt;);');
      expect(extractFlaXflScriptText('<script/>')).toBe('');
      expect(extractFlaXflScriptText('<script><![CDATA[unclosed')).toBeNull();
    });
  });

  describe('resolveMovieClipPlayheadFrame', () => {
    it('plays from 0 and holds at the first reachable stop frame', () => {
      expect(resolveMovieClipPlayheadFrame(0, 4, [3])).toBe(0);
      expect(resolveMovieClipPlayheadFrame(1, 4, [3])).toBe(1);
      expect(resolveMovieClipPlayheadFrame(2, 4, [3])).toBe(2);
      expect(resolveMovieClipPlayheadFrame(3, 4, [3])).toBe(3);
      expect(resolveMovieClipPlayheadFrame(7, 4, [3])).toBe(3);
    });

    it('holds at frame 0 when stopped on frame 0 and picks earliest of multiple stop frames', () => {
      expect(resolveMovieClipPlayheadFrame(0, 4, [0])).toBe(0);
      expect(resolveMovieClipPlayheadFrame(5, 4, [0])).toBe(0);
      expect(resolveMovieClipPlayheadFrame(0, 5, [1, 3])).toBe(0);
      expect(resolveMovieClipPlayheadFrame(1, 5, [1, 3])).toBe(1);
      expect(resolveMovieClipPlayheadFrame(4, 5, [1, 3])).toBe(1);
    });

    it('loops normally when no stop frames are present', () => {
      expect(resolveMovieClipPlayheadFrame(0, 3)).toBe(0);
      expect(resolveMovieClipPlayheadFrame(3, 3)).toBe(0);
      expect(resolveMovieClipPlayheadFrame(5, 3)).toBe(2);
    });
  });
});
