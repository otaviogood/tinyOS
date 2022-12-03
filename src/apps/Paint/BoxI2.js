import { ColorABGR } from "./ColorABGR";

export class int2 {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    Min(v) {
        return new int2(this.x < v.x ? this.x : v.x, this.y < v.y ? this.y : v.y)
    }
    Max(v) {
        return new int2(this.x > v.x ? this.x : v.x, this.y > v.y ? this.y : v.y)
    }
}

export class BoxI2 {
    assert(truth) {
        if (!truth) {
            throw Error("Assertion failed");
        }
    }

    constructor() {
        this.min = new int2(0x7FFFFFFF, 0x7FFFFFFF)
        this.max = new int2(-0x80000000, -0x80000000)
    }

    static new2(x, y, w, h) {
        let b = new BoxI2();
        b.min = new int2(x, y);
        b.max = new int2(x + w, y + h);
        return b;
    }

    SetUndefined() {
        this.min = new int2(0x7FFFFFFF, 0x7FFFFFFF)
        this.max = new int2(-0x80000000, -0x80000000)
    }

    IsDefined() {
        return (this.min.x <= this.max.x) && (this.min.y <= this.max.y)
      }
    

    MergePoint(p) {
        this.min = this.min.Min(p)
        this.max = this.max.Max(p)
    }

    Union(box) {
        this.MergePoint(box.min)
        this.MergePoint(box.max)
    }

    Intersects(box) {
        if (!this.IsDefined()) { return false }
        if (!box.IsDefined()) { return false }
        if (this.max.x < box.min.x) { return false }
        if (this.min.x > box.max.x) { return false }
        if (this.max.y < box.min.y) { return false }
        if (this.min.y > box.max.y) { return false }
        return true
      }
    
    Intersection(box) {
        if (!this.Intersects(box)) {
          this.SetUndefined()
          return
        }
        this.min = this.min.Max(box.min)
        this.max = this.max.Min(box.max)
      }
    
}
