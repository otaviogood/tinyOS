// Colors are stored directly as 32-bit integers.
export var ColorABGR = {};

function assert(truth) {
    if (!truth) {
        throw Error("Assertion failed");
    }
}

ColorABGR.withAlpha = function (self, a) {
    return ColorABGR.new2(self & 255, (self >> 8) & 255, (self >> 16) & 255, a);
};

ColorABGR.toString = function (self) {
    return (
        "Color(" +
        (self & 255).toString() +
        ", " +
        ((self >> 8) & 255).toString() +
        ", " +
        ((self >> 16) & 255).toString() +
        ", " +
        (self >>> 24).toString() +
        ")"
    );
};

ColorABGR.toRGBString = function (self) {
    return (
        "rgb(" + (self & 255).toString() + ", " + ((self >> 8) & 255).toString() + ", " + ((self >> 16) & 255).toString() + ")"
    );
};

// Linear interpolate from self to other.
// alpha is 0-255. 0 is self. 255 is other.
ColorABGR.lerp = function (self, other, alpha) {
    var rt = ((self & 255) + (((((other & 255) - (self & 255)) | 0) * alpha) >> 8)) | 0;
    var gt = (((self >> 8) & 255) + ((((((other >> 8) & 255) - ((self >> 8) & 255)) | 0) * alpha) >> 8)) | 0;
    var bt = (((self >> 16) & 255) + ((((((other >> 16) & 255) - ((self >> 16) & 255)) | 0) * alpha) >> 8)) | 0;
    return ColorABGR.new2(rt, gt, bt, 255);
};

ColorABGR.new2 = function (r, g, b, a) {
    assert(r >= 0 && r <= 255);
    assert(g >= 0 && g <= 255);
    assert(b >= 0 && b <= 255);
    assert(a >= 0 && a <= 255);
    return (b << 16) | (g << 8) | r | (a << 24);
};

ColorABGR.hex2 = function (rgb, a) {
    assert(rgb >= 0 && rgb <= 16777215);
    assert(a >= 0 && a <= 255);
    return rgb | (a << 24);
};

ColorABGR.fromRGBInt = function (rgb) {
    assert(rgb >= 0 && rgb <= 16777215);
    return ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb & 0xff0000) >> 16);
};

ColorABGR.fromHashTagColor = function(c) {
    let num = 0;
    if (c.startsWith("rgb(")) {

        let split = c.replace("rgb(","").replace(")","").split(",")
        let r = parseInt(split[0]) | 0;
        let g = parseInt(split[1]) | 0;
        let b = parseInt(split[2]) | 0;
        num = (r<<0)|(g<<8)|(b<<16);
    } else {
        const lookup = {"0":0, "1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,
        "a":10,"b":11,"c":12,"d":13,"e":14,"f":15,
        "A":10,"B":11,"C":12,"D":13,"E":14,"F":15}
        num += lookup[c.substring(1,2)] << 4;
        num += lookup[c.substring(2,3)] << 0;
        num += lookup[c.substring(3,4)] << 12;
        num += lookup[c.substring(4,5)] << 8;
        num += lookup[c.substring(5,6)] << 20;
        num += lookup[c.substring(6,7)] << 16;
    }
    return num;
}

ColorABGR.clamp = function (r, g, b) {
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
    return ColorABGR.new2(r, g, b, 255);
};

ColorABGR.HSVToRGB = function (hi, si, vi) {
    var fr = 0,
        fg = 0,
        fb = 0;
    var h = hi * 360;
    var s = si;
    var v = vi;
    var i = 0;
    var f = 0,
        p = 0,
        q = 0,
        t = 0;

    if (s == 0) {
        // gray
        fr = fg = fb = v;
    } else {
        h /= 60;
        i = Math.floor(h);

        // fractional part
        f = h - i;
        p = v * (1 - s);
        q = v * (1 - s * f);
        t = v * (1 - s * (1 - f));

        if (i == 1) {
            fr = q;
            fg = v;
            fb = p;
        } else if (i == 2) {
            fr = p;
            fg = v;
            fb = t;
        } else if (i == 3) {
            fr = p;
            fg = q;
            fb = v;
        } else if (i == 4) {
            fr = t;
            fg = p;
            fb = v;
        } else if (i == 5) {
            fr = v;
            fg = p;
            fb = q;
        } else {
            // i == 0
            fr = v;
            fg = t;
            fb = p;
        }
    }

    return ColorABGR.new2((fr * 255) | 0, (fg * 255) | 0, (fb * 255) | 0, 255);
};

ColorABGR.RGBToHSV = function (col) {
    var h = 0,
        s = 0,
        v = 0;
    var minColor = 0,
        maxColor = 0,
        delta = 0;
    minColor = Math.min(Math.min(col & 255, (col >> 8) & 255), (col >> 16) & 255);
    maxColor = Math.max(Math.max(col & 255, (col >> 8) & 255), (col >> 16) & 255);
    v = maxColor;
    delta = maxColor - minColor;

    if (delta != 0) {
        // This is different than the algorithm on the net. That one was buggy.
        s = delta / maxColor;

        if ((col & 255) == maxColor) {
            // between yellow & magenta
            h = ((((col >> 8) & 255) - ((col >> 16) & 255)) | 0) / delta;
        } else if (((col >> 8) & 255) == maxColor) {
            // between cyan & yellow
            h = 2 + ((((col >> 16) & 255) - (col & 255)) | 0) / delta;
        } else {
            // between magenta & cyan
            h = 4 + (((col & 255) - ((col >> 8) & 255)) | 0) / delta;
        }

        // degrees
        h *= 60;

        if (h < 0) {
            h += 360;
        }
    } else {
        // r = g = b = 0    # s = 0, v is undefined
        s = 0;
        h = 0;
    }

    h /= 360;

    // from [0..255] to [0..1]
    v /= 255;
    return [h, s, v];
};

ColorABGR.BLACK = ColorABGR.new2(0, 0, 0, 255);
ColorABGR.WHITE = ColorABGR.new2(255, 255, 255, 255);
