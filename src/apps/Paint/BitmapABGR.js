import { ColorABGR } from "./ColorABGR";

export class BitmapABGR {
    assert(truth) {
        if (!truth) {
            throw Error("Assertion failed");
        }
    }

    constructor(w, h, ctx) {
        this.width = 0;
        this.height = 0;
        this._imageData = null;
        this.data2 = null;
        this.context = null;
        this.dirty = true;
        this.cache = null;
        this.width = w;
        this.height = h;

        if (ctx !== null) {
            this.context = ctx;
            this._imageData = ctx.createImageData(w, h);
            this.data2 = new Int32Array(this._imageData.data.buffer);
        } else {
            this.data2 = new Int32Array(Math.imul(w, h));
        }

        this.dirty = true;
    }

    Clear(pix) {
        this.dirty = true;
        var size = Math.imul(this.width, this.height);

        for (var i = 0, count = size; i < count; i = (i + 1) | 0) {
            this.data2[i] = pix;
        }
    }

    InRange(x, y) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
            return false;
        }

        return true;
    }

    GetPixel(x, y) {
        return this.data2[(x + Math.imul(y, this.width)) | 0];
    }

    GetPixelZeroEdge(x, y) {
        if (!this.InRange(x, y)) {
            return ColorABGR.BLACK;
        }

        return this.data2[(x + Math.imul(y, this.width)) | 0];
    }

    GetPixelIndex(x, y) {
        return (x + Math.imul(y, this.width)) | 0;
    }

    SetPixel(x, y, pix) {
        this.dirty = true;
        this.data2[(x + Math.imul(y, this.width)) | 0] = pix | -16777216;
    }

    SetPixelAlpha(x, y, pix) {
        this.dirty = true;
        this.data2[(x + Math.imul(y, this.width)) | 0] = pix;
    }
    SetPixelSafeAlpha(x, y, pix) {
        if (!this.InRange(x, y)) {
            return;
        }

        this.dirty = true;
        this.data2[(x + Math.imul(y, this.width)) | 0] = pix;
    }

    DrawImage(x, y) {
        this.context.putImageData(this._imageData, x, y);
    }

    DrawSmear(xp0, yp0, xp1, yp1, radius, col, lastCol, brushHardness) {
        var resultBox = new BoxI2();
        var xd = xp1 - xp0;
        var yd = yp1 - yp0;
        var len = Math.sqrt(xd * xd + yd * yd);
        var skip = Math.max(0, Math.min(1, 4 / radius));
        len *= skip;
        len = Math.max(1, len);

        for (var i = 0, count = Math.round(len) | 0; i < count; i = (i + 1) | 0) {
            var alpha = i / len;
            var x = MathG.lerp2(xp0, xp1, alpha);
            var y = MathG.lerp2(yp0, yp1, alpha);

            // fade pen pressure along the stroke
            var c = ColorABGR.withAlpha(col, MathG.lerp(lastCol >>> 24, col >>> 24, Math.min(255, (alpha * 255) | 0)));
            var box = this.DrawBlobAlpha(x, y, radius, c, brushHardness, skip);
            resultBox.Union(box);
        }

        return resultBox;
    }

    DrawBlobAlpha(xp, yp, radius, col, brushHardness, skip) {
        var xmin = Math.floor(xp - radius) | 0;
        var xmax = Math.ceil(xp + radius) | 0;
        var ymin = Math.floor(yp - radius) | 0;
        var ymax = Math.ceil(yp + radius) | 0;
        xmin = Math.max(xmin, 0);
        ymin = Math.max(ymin, 0);
        xmax = Math.min(xmax, this.width);
        ymax = Math.min(ymax, this.height);
        var colorAlreadyExists = ColorABGR.withAlpha(col, 255);

        for (var y = ymin, count1 = ymax; y < count1; y = (y + 1) | 0) {
            var index = this.GetPixelIndex(xmin, y);

            for (var x = xmin, count = xmax; x < count; x = (x + 1) | 0) {
                var pix = this.data2[index];

                // Only go through the effort if the pixel doesn't already have the right color.
                if (pix != colorAlreadyExists) {
                    var len = Math.sqrt((x - xp) * (x - xp) + (y - yp) * (y - yp));
                    var brush = Math.max(0, Math.min(1, 1 - len / radius));
                    brush = brush / radius;
                    brush = brush * brushHardness * radius + (1 - brush) * brush * 2;
                    brush /= skip;

                    // var blend = Math.max(pix.a, (brush * 255) as int)
                    var Src = ((col >>> 24) * brush) | 0;
                    var Base = pix >>> 24;
                    var Opacity = col >>> 24;
                    var blend = Math.max(Math.min((((Src + Base) | 0) - ((Src * Base) >> 8)) | 0, Opacity), Base);

                    // SetPixel(x, y, col.withAlpha(blend))
                    this.data2[index] = ColorABGR.withAlpha(col, blend);
                }

                index = (index + 1) | 0;
            }
        }

        return new BoxI2.new2(xmin, ymin, (xmax - xmin) | 0, (ymax - ymin) | 0);
    }

    DrawCircle(xp, yp, radius, col) {
        var xmin = Math.floor(xp - radius) | 0;
        var xmax = Math.ceil(xp + radius) | 0;
        var ymin = Math.floor(yp - radius) | 0;
        var ymax = Math.ceil(yp + radius) | 0;

        for (var y = ymin, count1 = ymax; y < count1; y = (y + 1) | 0) {
            for (var x = xmin, count = xmax; x < count; x = (x + 1) | 0) {
                var len = Math.sqrt((Math.imul((x - xp) | 0, (x - xp) | 0) + Math.imul((y - yp) | 0, (y - yp) | 0)) | 0);
                var a = Math.max(0, Math.min(1, 1 - len / radius));
                var pix = this.GetPixel(x, y);
                var ramp = 1 - Math.max(0, Math.min(1, Math.abs(0.5 - a) * radius - 0.25));
                var alpha = Math.max(pix >>> 24, (ramp * 255) | 0);
                pix = ColorABGR.lerp(pix, col, (ramp * 255) | 0);

                // This doesn't work at the edge of the box. Good enough for now.
                pix = ColorABGR.withAlpha(pix, alpha);
                this.SetPixelSafeAlpha(x, y, pix);
            }
        }
    }

    OverlayBox(source, dirtyBox) {
        assert(source.width == this.width);
        assert(source.height == this.height);
        this.dirty = true;
        var clip = new BoxI2.new2(0, 0, (source.width - 1) | 0, (source.height - 1) | 0);
        clip.Intersection(dirtyBox);

        for (var y = clip.min.y, count1 = (clip.max.y + 1) | 0; y < count1; y = (y + 1) | 0) {
            var index = this.GetPixelIndex(clip.min.x, y);
            var sourceD = source.data2;

            for (var x = clip.min.x, count = (clip.max.x + 1) | 0; x < count; x = (x + 1) | 0) {
                // var pix = source.GetPixel(x, y)
                var pix = sourceD[index];

                if (pix >>> 24 != 0) {
                    // var pix2 = GetPixel(x, y)
                    var pix2 = this.data2[index];

                    // SetPixel(x, y, pix2.lerp(pix, pix.a))
                    this.data2[index] = ColorABGR.lerp(pix2, pix, pix >>> 24);
                }

                index = (index + 1) | 0;
            }
        }
    }

    CopyAndOverlay2(source0, source1, dirtyBox) {
        assert(source0.width == this.width);
        assert(source0.height == this.height);
        assert(source1.width == this.width);
        assert(source1.height == this.height);
        this.dirty = true;
        var clip = new BoxI2.new2(0, 0, (this.width - 1) | 0, (this.height - 1) | 0);
        clip.Intersection(dirtyBox);

        for (var y = clip.min.y, count1 = (clip.max.y + 1) | 0; y < count1; y = (y + 1) | 0) {
            for (var x = clip.min.x, count = (clip.max.x + 1) | 0; x < count; x = (x + 1) | 0) {
                var pix1 = source1.GetPixel(x, y);

                if (pix1 >>> 24 != 0) {
                    var pix0 = source0.GetPixel(x, y);
                    pix0 = ColorABGR.lerp(pix0, pix1, pix1 >>> 24);
                    this.SetPixel(x, y, pix0);
                }
            }
        }
    }

    CopyBitsNew() {
        var result = new BitmapABGR(this.width, this.height, null);
        result.data2.set(this.data2);

        // for i in 0..height*width {
        //   result.data2[i] = data2[i]
        // }
        return result;
    }

    CopyBitsFrom(source) {
        assert(source.width == this.width);
        assert(source.height == this.height);
        this.dirty = true;
        this.data2.set(source.data2);
    }
}
