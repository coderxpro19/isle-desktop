//! CF_DIB (packed device-independent bitmap) ⇄ RGBA, plus PNG helpers.
#![cfg_attr(not(windows), allow(dead_code))]

pub struct Rgba {
    pub w: u32,
    pub h: u32,
    pub px: Vec<u8>,
}

fn u32le(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}
fn i32le(b: &[u8], o: usize) -> Option<i32> {
    u32le(b, o).map(|v| v as i32)
}
fn u16le(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?))
}

/// Parse a packed DIB (BITMAPINFOHEADER + optional masks + pixels), 24/32 bpp.
pub fn dib_to_rgba(b: &[u8]) -> Option<Rgba> {
    let hsize = u32le(b, 0)? as usize;
    let w = i32le(b, 4)?;
    let h = i32le(b, 8)?;
    let bpp = u16le(b, 14)?;
    let comp = u32le(b, 16)?;
    if w <= 0 || h == 0 || w > 16384 || h.abs() > 16384 || !(bpp == 24 || bpp == 32) {
        return None;
    }
    // BI_RGB = 0, BI_BITFIELDS = 3 (three DWORD masks follow a 40-byte header).
    let masks = if comp == 3 && hsize == 40 { 12 } else { 0 };
    if comp != 0 && comp != 3 {
        return None;
    }
    let (w, top_down, h) = (w as usize, h < 0, h.unsigned_abs() as usize);
    let stride = (w * bpp as usize / 8).div_ceil(4) * 4;
    let start = hsize + masks;
    let data = b.get(start..start + stride * h)?;
    let mut px = vec![0u8; w * h * 4];
    let mut any_alpha = false;
    for y in 0..h {
        let src_y = if top_down { y } else { h - 1 - y };
        let row = &data[src_y * stride..];
        for x in 0..w {
            let (s, d) = (x * (bpp as usize / 8), (y * w + x) * 4);
            px[d] = row[s + 2];
            px[d + 1] = row[s + 1];
            px[d + 2] = row[s];
            px[d + 3] = if bpp == 32 { row[s + 3] } else { 255 };
            any_alpha |= bpp == 32 && row[s + 3] != 0;
        }
    }
    if bpp == 32 && !any_alpha {
        px.chunks_exact_mut(4).for_each(|p| p[3] = 255);
    }
    Some(Rgba {
        w: w as u32,
        h: h as u32,
        px,
    })
}

/// RGBA → packed 32-bpp bottom-up DIB (what CF_DIB consumers expect).
pub fn rgba_to_dib(img: &Rgba) -> Vec<u8> {
    let (w, h) = (img.w as usize, img.h as usize);
    let mut out = Vec::with_capacity(40 + w * h * 4);
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(w as i32).to_le_bytes());
    out.extend_from_slice(&(h as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    out.extend_from_slice(&((w * h * 4) as u32).to_le_bytes());
    out.extend_from_slice(&[0u8; 16]); // ppm x/y, clr used/important
    for y in (0..h).rev() {
        for x in 0..w {
            let s = (y * w + x) * 4;
            out.extend_from_slice(&[img.px[s + 2], img.px[s + 1], img.px[s], img.px[s + 3]]);
        }
    }
    out
}

pub fn encode_png(img: &Rgba) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, img.w, img.h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().ok()?;
        wr.write_image_data(&img.px).ok()?;
    }
    Some(out)
}

pub fn decode_png(bytes: &[u8]) -> Option<Rgba> {
    let mut dec = png::Decoder::new(std::io::Cursor::new(bytes));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::ALPHA);
    let mut r = dec.read_info().ok()?;
    let mut buf = vec![0; r.output_buffer_size()];
    let info = r.next_frame(&mut buf).ok()?;
    let (w, h) = (info.width, info.height);
    let px = match info.color_type {
        png::ColorType::Rgba => buf[..(w * h * 4) as usize].to_vec(),
        png::ColorType::GrayscaleAlpha => buf[..(w * h * 2) as usize]
            .chunks_exact(2)
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        _ => return None,
    };
    Some(Rgba { w, h, px })
}

/// Box-filter downscale so the longest side is at most `max`.
pub fn thumbnail(img: &Rgba, max: u32) -> Rgba {
    let scale = (img.w.max(img.h) as f32 / max as f32).max(1.0);
    if scale <= 1.0 {
        return Rgba {
            w: img.w,
            h: img.h,
            px: img.px.clone(),
        };
    }
    let (tw, th) = (
        ((img.w as f32 / scale) as u32).max(1),
        ((img.h as f32 / scale) as u32).max(1),
    );
    let mut px = vec![0u8; (tw * th * 4) as usize];
    for ty in 0..th {
        for tx in 0..tw {
            let (x0, x1) = (
                (tx * img.w / tw),
                ((tx + 1) * img.w / tw).max(tx * img.w / tw + 1),
            );
            let (y0, y1) = (
                (ty * img.h / th),
                ((ty + 1) * img.h / th).max(ty * img.h / th + 1),
            );
            let mut acc = [0u32; 4];
            let mut n = 0;
            for y in y0..y1.min(img.h) {
                for x in x0..x1.min(img.w) {
                    let s = ((y * img.w + x) * 4) as usize;
                    for (c, a) in acc.iter_mut().enumerate() {
                        *a += img.px[s + c] as u32;
                    }
                    n += 1;
                }
            }
            let d = ((ty * tw + tx) * 4) as usize;
            for (c, a) in acc.iter().enumerate() {
                px[d + c] = (a / n.max(1)) as u8;
            }
        }
    }
    Rgba { w: tw, h: th, px }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Rgba {
        // 3×2: distinct colours, one translucent pixel.
        let px = vec![
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, //
            10, 20, 30, 128, 40, 50, 60, 255, 70, 80, 90, 255,
        ];
        Rgba { w: 3, h: 2, px }
    }

    #[test]
    fn dib_round_trip() {
        let img = sample();
        let back = dib_to_rgba(&rgba_to_dib(&img)).unwrap();
        assert_eq!((back.w, back.h), (3, 2));
        assert_eq!(back.px, img.px);
    }

    #[test]
    fn reads_24bpp_bottom_up_with_padding() {
        // 1×2 image, 24 bpp: rows padded to 4 bytes; bottom row first.
        let mut b = vec![0u8; 40];
        b[0] = 40;
        b[4] = 1;
        b[8] = 2;
        b[12] = 1;
        b[14] = 24;
        b.extend_from_slice(&[1, 2, 3, 0]); // bottom pixel BGR + pad
        b.extend_from_slice(&[4, 5, 6, 0]); // top pixel
        let img = dib_to_rgba(&b).unwrap();
        assert_eq!(img.px, vec![6, 5, 4, 255, 3, 2, 1, 255]);
    }

    #[test]
    fn png_round_trip_and_thumb() {
        let img = sample();
        let back = decode_png(&encode_png(&img).unwrap()).unwrap();
        assert_eq!(back.px, img.px);
        let t = thumbnail(
            &Rgba {
                w: 400,
                h: 200,
                px: vec![9; 400 * 200 * 4],
            },
            100,
        );
        assert_eq!((t.w, t.h), (100, 50));
        assert!(t.px.iter().all(|&v| v == 9));
    }
}
