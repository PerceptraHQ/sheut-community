use std::collections::HashMap;
use std::io::Cursor;

use fontdue::{
    Font, FontSettings,
    layout::{CoordinateSystem, HorizontalAlign, Layout, LayoutSettings, TextStyle, VerticalAlign},
};
use image::{
    ImageEncoder, Rgba, RgbaImage,
    codecs::png::PngEncoder,
    imageops::{FilterType, overlay, resize},
};

const WIDTH: u32 = 1600;
const HEIGHT: u32 = 900;
const MARGIN: f64 = 130.0;
const NODE_RADIUS: f64 = 40.0;
const GRAPH_FONT: &[u8] = include_bytes!("../assets/fonts/Geist-Variable.ttf");

#[derive(Debug, Clone, Copy)]
pub(crate) enum SnapshotNodeKind {
    Intelligence,
    Evidence,
    Document,
    CatalogReference,
}

#[derive(Debug, Clone)]
pub(crate) struct SnapshotNode {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub kind: SnapshotNodeKind,
    pub object_type: String,
    pub display_name: String,
    pub available: bool,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum SnapshotEdgeKind {
    Semantic,
    Reference,
    Visual,
    Draft,
}

#[derive(Debug, Clone)]
pub(crate) struct SnapshotEdge {
    pub source_id: String,
    pub target_id: String,
    pub label: String,
    pub kind: SnapshotEdgeKind,
    pub directed: bool,
}

pub(crate) fn render(nodes: &[SnapshotNode], edges: &[SnapshotEdge]) -> Result<Vec<u8>, ()> {
    let font = Font::from_bytes(GRAPH_FONT, FontSettings::default()).map_err(|_| ())?;
    let mut image = RgbaImage::from_pixel(WIDTH, HEIGHT, Rgba([248, 250, 252, 255]));
    let positions = projected_positions(nodes);

    for edge in edges {
        let (Some(source), Some(target)) = (
            positions.get(&edge.source_id).copied(),
            positions.get(&edge.target_id).copied(),
        ) else {
            continue;
        };
        draw_edge(&mut image, &font, edge, source, target);
    }

    let mut icon_cache = HashMap::<String, RgbaImage>::new();
    for node in nodes {
        let Some(center) = positions.get(&node.id).copied() else {
            continue;
        };
        draw_node(&mut image, &font, &mut icon_cache, center, node);
    }

    let mut payload = Cursor::new(Vec::new());
    PngEncoder::new(&mut payload)
        .write_image(
            image.as_raw(),
            WIDTH,
            HEIGHT,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|_| ())?;
    Ok(payload.into_inner())
}

fn projected_positions(nodes: &[SnapshotNode]) -> HashMap<String, (i32, i32)> {
    let min_x = nodes
        .iter()
        .map(|node| node.x)
        .fold(f64::INFINITY, f64::min);
    let max_x = nodes
        .iter()
        .map(|node| node.x)
        .fold(f64::NEG_INFINITY, f64::max);
    let min_y = nodes
        .iter()
        .map(|node| node.y)
        .fold(f64::INFINITY, f64::min);
    let max_y = nodes
        .iter()
        .map(|node| node.y)
        .fold(f64::NEG_INFINITY, f64::max);
    let available_width = f64::from(WIDTH) - MARGIN * 2.0;
    let available_height = f64::from(HEIGHT) - MARGIN * 2.0;

    nodes
        .iter()
        .map(|node| {
            let x = if !min_x.is_finite() || (max_x - min_x).abs() < f64::EPSILON {
                f64::from(WIDTH) / 2.0
            } else {
                MARGIN + (node.x - min_x) / (max_x - min_x) * available_width
            };
            let y = if !min_y.is_finite() || (max_y - min_y).abs() < f64::EPSILON {
                f64::from(HEIGHT) / 2.0
            } else {
                MARGIN + (node.y - min_y) / (max_y - min_y) * available_height
            };
            (node.id.clone(), (x.round() as i32, y.round() as i32))
        })
        .collect()
}

fn draw_edge(
    image: &mut RgbaImage,
    font: &Font,
    edge: &SnapshotEdge,
    source: (i32, i32),
    target: (i32, i32),
) {
    let dx = f64::from(target.0 - source.0);
    let dy = f64::from(target.1 - source.1);
    let length = dx.hypot(dy).max(1.0);
    let unit_x = dx / length;
    let unit_y = dy / length;
    let start = (
        (f64::from(source.0) + unit_x * NODE_RADIUS).round() as i32,
        (f64::from(source.1) + unit_y * NODE_RADIUS).round() as i32,
    );
    let end = (
        (f64::from(target.0) - unit_x * NODE_RADIUS).round() as i32,
        (f64::from(target.1) - unit_y * NODE_RADIUS).round() as i32,
    );
    let (color, dash) = edge_style(edge.kind);
    draw_line(image, start, end, color, dash);
    if edge.directed {
        draw_arrowhead(image, end, unit_x, unit_y, color);
    }

    let label = match edge.kind {
        SnapshotEdgeKind::Semantic => edge.label.clone(),
        SnapshotEdgeKind::Reference => format!("Reference · {}", edge.label),
        SnapshotEdgeKind::Visual => format!("Visual · {}", edge.label),
        SnapshotEdgeKind::Draft => format!("Draft · {}", edge.label),
    };
    let midpoint = ((start.0 + end.0) / 2, (start.1 + end.1) / 2);
    fill_rect(
        image,
        midpoint.0 - 92,
        midpoint.1 - 13,
        184,
        25,
        Rgba([248, 250, 252, 245]),
    );
    draw_text(
        image,
        font,
        &truncate(&label, 28),
        midpoint.0,
        midpoint.1 - 9,
        13.0,
        Rgba([31, 41, 55, 255]),
        176.0,
    );
}

fn edge_style(kind: SnapshotEdgeKind) -> (Rgba<u8>, Option<(usize, usize)>) {
    match kind {
        SnapshotEdgeKind::Semantic => (Rgba([37, 99, 235, 255]), None),
        SnapshotEdgeKind::Reference => (Rgba([22, 101, 52, 255]), Some((3, 4))),
        SnapshotEdgeKind::Visual => (Rgba([75, 85, 99, 255]), Some((8, 5))),
        SnapshotEdgeKind::Draft => (Rgba([126, 34, 206, 255]), Some((5, 4))),
    }
}

fn draw_line(
    image: &mut RgbaImage,
    start: (i32, i32),
    end: (i32, i32),
    color: Rgba<u8>,
    dash: Option<(usize, usize)>,
) {
    let (mut x0, mut y0) = start;
    let (x1, y1) = end;
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut error = dx + dy;
    let mut step = 0_usize;
    loop {
        if dash.is_none_or(|(draw, gap)| step % (draw + gap) < draw) {
            for offset_y in -1..=1 {
                for offset_x in -1..=1 {
                    put_pixel(image, x0 + offset_x, y0 + offset_y, color);
                }
            }
        }
        if x0 == x1 && y0 == y1 {
            break;
        }
        let doubled = error * 2;
        if doubled >= dy {
            error += dy;
            x0 += sx;
        }
        if doubled <= dx {
            error += dx;
            y0 += sy;
        }
        step = step.saturating_add(1);
    }
}

fn draw_arrowhead(
    image: &mut RgbaImage,
    end: (i32, i32),
    unit_x: f64,
    unit_y: f64,
    color: Rgba<u8>,
) {
    let left = (
        (f64::from(end.0) - unit_x * 13.0 - unit_y * 7.0).round() as i32,
        (f64::from(end.1) - unit_y * 13.0 + unit_x * 7.0).round() as i32,
    );
    let right = (
        (f64::from(end.0) - unit_x * 13.0 + unit_y * 7.0).round() as i32,
        (f64::from(end.1) - unit_y * 13.0 - unit_x * 7.0).round() as i32,
    );
    draw_line(image, end, left, color, None);
    draw_line(image, end, right, color, None);
}

fn draw_node(
    image: &mut RgbaImage,
    font: &Font,
    icon_cache: &mut HashMap<String, RgbaImage>,
    center: (i32, i32),
    node: &SnapshotNode,
) {
    const RADIUS: i32 = 40;
    let fill = if !node.available {
        Rgba([229, 231, 235, 255])
    } else {
        match node.kind {
            SnapshotNodeKind::Intelligence => Rgba([219, 234, 254, 255]),
            SnapshotNodeKind::Evidence => Rgba([220, 252, 231, 255]),
            SnapshotNodeKind::Document => Rgba([254, 226, 226, 255]),
            SnapshotNodeKind::CatalogReference => Rgba([243, 232, 255, 255]),
        }
    };
    for y in center.1 - RADIUS..=center.1 + RADIUS {
        for x in center.0 - RADIUS..=center.0 + RADIUS {
            let distance_squared = (x - center.0).pow(2) + (y - center.1).pow(2);
            if distance_squared <= RADIUS.pow(2) {
                put_pixel(
                    image,
                    x,
                    y,
                    if distance_squared >= (RADIUS - 3).pow(2) {
                        Rgba([51, 65, 85, 255])
                    } else {
                        fill
                    },
                );
            }
        }
    }
    if node.available {
        let icon = icon_cache
            .entry(node.object_type.clone())
            .or_insert_with(|| {
                let decoded = image::load_from_memory(icon_png(&node.object_type))
                    .expect("embedded STIX graph icons are valid images")
                    .to_rgba8();
                resize(&decoded, 37, 37, FilterType::Lanczos3)
            });
        overlay(
            image,
            icon,
            i64::from(center.0 - 18),
            i64::from(center.1 - 18),
        );
    } else {
        draw_text(
            image,
            font,
            "!",
            center.0,
            center.1 - 13,
            24.0,
            Rgba([127, 29, 29, 255]),
            32.0,
        );
    }
    draw_text(
        image,
        font,
        &node.object_type.replace('-', " ").to_uppercase(),
        center.0,
        center.1 + RADIUS + 8,
        12.0,
        Rgba([51, 65, 85, 255]),
        190.0,
    );
    draw_text(
        image,
        font,
        &truncate(&node.display_name, 30),
        center.0,
        center.1 + RADIUS + 27,
        15.0,
        Rgba([15, 23, 42, 255]),
        220.0,
    );
}

#[allow(clippy::too_many_arguments)]
fn draw_text(
    image: &mut RgbaImage,
    font: &Font,
    text: &str,
    center_x: i32,
    top_y: i32,
    size: f32,
    color: Rgba<u8>,
    max_width: f32,
) {
    let mut layout = Layout::new(CoordinateSystem::PositiveYDown);
    layout.reset(&LayoutSettings {
        x: center_x as f32 - max_width / 2.0,
        y: top_y as f32,
        max_width: Some(max_width),
        max_height: Some(size * 1.6),
        horizontal_align: HorizontalAlign::Center,
        vertical_align: VerticalAlign::Top,
        ..LayoutSettings::default()
    });
    layout.append(&[font], &TextStyle::new(text, size, 0));
    for glyph in layout.glyphs() {
        let (_, bitmap) = font.rasterize_config(glyph.key);
        let origin_x = glyph.x.round() as i32;
        let origin_y = glyph.y.round() as i32;
        for glyph_y in 0..glyph.height {
            for glyph_x in 0..glyph.width {
                let coverage = bitmap[glyph_y * glyph.width + glyph_x];
                if coverage > 0 {
                    blend_pixel(
                        image,
                        origin_x + i32::try_from(glyph_x).unwrap_or(i32::MAX),
                        origin_y + i32::try_from(glyph_y).unwrap_or(i32::MAX),
                        color,
                        coverage,
                    );
                }
            }
        }
    }
}

fn fill_rect(image: &mut RgbaImage, x: i32, y: i32, width: i32, height: i32, color: Rgba<u8>) {
    for row in y..y.saturating_add(height) {
        for column in x..x.saturating_add(width) {
            blend_pixel(image, column, row, color, color.0[3]);
        }
    }
}

fn put_pixel(image: &mut RgbaImage, x: i32, y: i32, color: Rgba<u8>) {
    if let (Ok(x), Ok(y)) = (u32::try_from(x), u32::try_from(y))
        && x < image.width()
        && y < image.height()
    {
        image.put_pixel(x, y, color);
    }
}

fn blend_pixel(image: &mut RgbaImage, x: i32, y: i32, color: Rgba<u8>, coverage: u8) {
    let (Ok(x), Ok(y)) = (u32::try_from(x), u32::try_from(y)) else {
        return;
    };
    if x >= image.width() || y >= image.height() {
        return;
    }
    let destination = image.get_pixel_mut(x, y);
    let alpha = u16::from(coverage) * u16::from(color.0[3]) / 255;
    for channel in 0..3 {
        destination.0[channel] = u8::try_from(
            (u16::from(color.0[channel]) * alpha
                + u16::from(destination.0[channel]) * (255 - alpha))
                / 255,
        )
        .unwrap_or(255);
    }
    destination.0[3] = 255;
}

fn truncate(value: &str, max_chars: usize) -> String {
    let mut characters = value.chars();
    let mut output = characters.by_ref().take(max_chars).collect::<String>();
    if characters.next().is_some() {
        output.push('…');
    }
    output
}

fn icon_png(object_type: &str) -> &'static [u8] {
    macro_rules! icon {
        ($name:literal) => {
            include_bytes!(concat!(
                "../../src/assets/stix-icons/stix2_",
                $name,
                "_icon_tiny_round_v1.png"
            ))
            .as_slice()
        };
    }
    match object_type {
        "attack-pattern" => icon!("attack_pattern"),
        "campaign" => icon!("campaign"),
        "course-of-action" => icon!("course_of_action"),
        "grouping" => icon!("grouping"),
        "identity" => icon!("identity"),
        "incident" => icon!("incident"),
        "indicator" => icon!("indicator"),
        "infrastructure" => icon!("infrastructure"),
        "intrusion-set" => icon!("intrusion_set"),
        "location" => icon!("location"),
        "malware" => icon!("malware"),
        "malware-analysis" => icon!("malware_analysis"),
        "note" | "analyst-note" => icon!("note"),
        "observed-data" => icon!("observed_data"),
        "opinion" => icon!("opinion"),
        "relationship" => icon!("relationship"),
        "report" => icon!("report"),
        "sighting" => icon!("sighting"),
        "threat-actor" => icon!("threat_actor"),
        "tool" => icon!("tool"),
        "vulnerability" => icon!("vulnerability"),
        "artifact" => icon!("artifact"),
        "autonomous-system" => icon!("autonomous_system"),
        "directory" => icon!("directory"),
        "domain-name" => icon!("domain_name"),
        "email-addr" => icon!("email_addr"),
        "email-message" => icon!("email_message"),
        "file" => icon!("file"),
        "ipv4-addr" => icon!("ipv4_addr"),
        "ipv6-addr" => icon!("ipv6_addr"),
        "mac-addr" => icon!("mac_addr"),
        "mutex" => icon!("mutex"),
        "network-traffic" => icon!("network_traffic"),
        "process" => icon!("process"),
        "software" => icon!("software"),
        "url" => icon!("url"),
        "user-account" => icon!("user_account"),
        "windows-registry-key" => icon!("windows_registry_key"),
        "x509-certificate" => icon!("x509_certificate"),
        "marking-definition" => icon!("marking_definition"),
        "language-content" => icon!("language"),
        _ => icon!("bundle"),
    }
}
