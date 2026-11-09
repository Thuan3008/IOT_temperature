"""Build the course report from the repository's implemented architecture."""

from pathlib import Path
import json
import math

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.section import WD_SECTION_START
from docx.shared import Cm, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "reports"
ASSET_DIR = OUT_DIR / "report_assets"
OUT_DIR.mkdir(exist_ok=True)
ASSET_DIR.mkdir(exist_ok=True)
OUTPUT = OUT_DIR / "Bao_cao_mon_IoT_giam_sat_chuoi_lanh.docx"
PAGE_MAP_PATH = OUT_DIR / "report_page_map.json"
PAGE_MAP = json.loads(PAGE_MAP_PATH.read_text(encoding="utf-8")) if PAGE_MAP_PATH.exists() else {}

BLUE = RGBColor(25, 58, 91)
MID_BLUE = RGBColor(33, 91, 133)
GRAY = RGBColor(91, 100, 110)
LIGHT = RGBColor(235, 242, 248)


def font(size=12, bold=False):
    candidates = [
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path(r"C:\Windows\Fonts\Arial.ttf"),
    ]
    if bold:
        candidates.insert(0, Path(r"C:\Windows\Fonts\arialbd.ttf"))
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def multiline_center(draw, xy, text, width, fill, size=29, bold=False):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font(size, bold))[2] > width and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    y = xy[1] - (len(lines) - 1) * (size + 6) / 2
    for line in lines:
        draw.text((xy[0], y), line, fill=fill, font=font(size, bold), anchor="mt")
        y += size + 6


def box(draw, rect, title, subtitle="", fill="#e8f2f8", outline="#3376a3"):
    draw.rounded_rectangle(rect, radius=24, fill=fill, outline=outline, width=4)
    x0, y0, x1, y1 = rect
    multiline_center(draw, ((x0 + x1) / 2, (y0 + y1) / 2 - (16 if subtitle else 0)), title, x1 - x0 - 35, "#173851", 27, True)
    if subtitle:
        multiline_center(draw, ((x0 + x1) / 2, (y0 + y1) / 2 + 33), subtitle, x1 - x0 - 28, "#546878", 19)


def arrow(draw, a, b, label=""):
    draw.line([a, b], fill="#477a9b", width=5)
    angle = math.atan2(b[1] - a[1], b[0] - a[0])
    for delta in (-0.45, 0.45):
        tip = (b[0] - 16 * math.cos(angle + delta), b[1] - 16 * math.sin(angle + delta))
        draw.line([b, tip], fill="#477a9b", width=5)
    if label:
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        draw.text((mx, my - 11), label, fill="#315b77", font=font(18), anchor="mm")


def architecture_figure():
    image = Image.new("RGB", (1600, 840), "white")
    d = ImageDraw.Draw(image)
    d.text((800, 35), "KIẾN TRÚC HỆ THỐNG GIÁM SÁT CHUỖI LẠNH", fill="#173851", font=font(37, True), anchor="mt")
    box(d, (70, 180, 360, 390), "ESP32 / Wokwi", "5 DHT22 · cửa · GPS giả")
    box(d, (475, 180, 745, 390), "Mosquitto", "MQTT broker + ACL")
    box(d, (865, 180, 1160, 390), "Backend", "Node.js · cảnh báo")
    box(d, (1260, 125, 1530, 285), "SQL Server", "Lịch sử · sự cố")
    box(d, (1260, 330, 1530, 490), "Dashboard", "React · bản đồ")
    box(d, (1260, 540, 1530, 700), "Telegram", "Tin cảnh báo")
    arrow(d, (360, 270), (475, 270), "telemetry")
    arrow(d, (745, 270), (865, 270), "subscribe")
    arrow(d, (1160, 220), (1260, 205), "SQL")
    arrow(d, (1160, 305), (1260, 410), "API / SSE")
    arrow(d, (1130, 390), (1260, 615), "alert")
    d.rounded_rectangle((70, 565, 1160, 710), radius=23, fill="#f6f8fb", outline="#a9c1d2", width=3)
    multiline_center(d, (615, 609), "Điều khiển hai chiều", 1000, "#173851", 28, True)
    multiline_center(d, (615, 660), "Dashboard → Backend → command → ESP32 → ACK", 1000, "#385d78", 23)
    path = ASSET_DIR / "kien_truc.png"
    image.save(path)
    return path


def alert_figure():
    image = Image.new("RGB", (1540, 540), "white")
    d = ImageDraw.Draw(image)
    d.text((770, 25), "VÒNG ĐỜI MỘT SỰ CỐ", fill="#173851", font=font(36, True), anchor="mt")
    box(d, (55, 185, 365, 390), "Bình thường", "Chưa có sự cố")
    box(d, (475, 185, 800, 390), "OPEN", "Tạo một bản ghi")
    box(d, (915, 185, 1240, 390), "Đang tiếp diễn", "Tăng số lần ghi nhận")
    box(d, (1280, 185, 1510, 390), "Phục hồi", "Ghi recovered_at")
    arrow(d, (365, 286), (475, 286), "phát hiện")
    arrow(d, (800, 286), (915, 286), "mẫu tiếp")
    arrow(d, (1240, 286), (1280, 286))
    d.text((770, 460), "Telegram gửi khi mở sự cố; nút Đã xử lý có thể đóng hiển thị trước khi cảm biến phục hồi.", fill="#536b7d", font=font(22), anchor="mt")
    path = ASSET_DIR / "vong_doi_canh_bao.png"
    image.save(path)
    return path


def buffer_figure():
    image = Image.new("RGB", (1540, 500), "white")
    d = ImageDraw.Draw(image)
    d.text((770, 25), "LƯU ĐỆM KHI MẤT KẾT NỐI", fill="#173851", font=font(36, True), anchor="mt")
    box(d, (75, 160, 385, 355), "Lấy mẫu 4 giây", "5 DHT22 + trạng thái")
    box(d, (505, 160, 895, 355), "Ring Buffer RAM", "Tối đa 30 gói · FIFO")
    box(d, (1015, 160, 1450, 355), "Gửi lại qua MQTT", "isBuffered = true")
    arrow(d, (385, 255), (505, 255), "offline")
    arrow(d, (895, 255), (1015, 255), "online")
    d.text((770, 420), "Queue đầy ghi đè gói cũ nhất; reset hoặc mất nguồn sẽ mất dữ liệu trong RAM.", fill="#536b7d", font=font(22), anchor="mt")
    path = ASSET_DIR / "ring_buffer.png"
    image.save(path)
    return path


def shade(cell, color="EAF2F7"):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), color)
    tc_pr.append(shd)


def set_cell_border(cell, color="D9E4EC"):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        tag = OxmlElement(f"w:{edge}")
        tag.set(qn("w:val"), "single")
        tag.set(qn("w:sz"), "4")
        tag.set(qn("w:color"), color)
        borders.append(tag)
    tc_pr.append(borders)


def add_table(doc, headers, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table.style = "Table Grid"
    for i, header in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = header
        shade(cell, "DCEAF3")
        for run in cell.paragraphs[0].runs:
            run.bold = True
            run.font.color.rgb = BLUE
            run.font.size = Pt(10)
    for row in rows:
        cells = table.add_row().cells
        for i, value in enumerate(row):
            cells[i].text = str(value)
            cells[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            for para in cells[i].paragraphs:
                para.paragraph_format.space_after = Pt(0)
                for run in para.runs:
                    run.font.size = Pt(9.5)
        if len(table.rows) % 2 == 0:
            for cell in cells:
                shade(cell, "F7FAFC")
    for row in table.rows:
        for cell in row.cells:
            set_cell_border(cell)
    if widths:
        for row in table.rows:
            for cell, width in zip(row.cells, widths):
                cell.width = Cm(width)
    doc.add_paragraph()
    return table


def add_p(doc, text="", bold_start=None):
    p = doc.add_paragraph(style="Normal")
    if bold_start and text.startswith(bold_start):
        p.add_run(bold_start).bold = True
        p.add_run(text[len(bold_start):])
    else:
        p.add_run(text)
    return p


def add_bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    p.add_run(text)
    return p


HEADINGS = []


def h1(doc, text):
    p = doc.add_paragraph(text, style="Heading 1")
    HEADINGS.append((1, text))
    return p


def h2(doc, text):
    p = doc.add_paragraph(text, style="Heading 2")
    HEADINGS.append((2, text))
    return p


def image_with_caption(doc, image_path, caption, width_cm=15.8):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(image_path), width=Cm(width_cm))
    c = doc.add_paragraph(style="Caption")
    c.alignment = WD_ALIGN_PARAGRAPH.CENTER
    c.add_run(caption)
    return p


def image_placeholder(doc, caption, instructions):
    table = doc.add_table(rows=1, cols=1)
    cell = table.cell(0, 0)
    shade(cell, "F2F5F7")
    set_cell_border(cell, "A8B9C6")
    cell.text = "ẢNH CẦN BỔ SUNG\n" + instructions
    for p in cell.paragraphs:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in p.runs:
            run.font.color.rgb = GRAY
            run.italic = True
    cell.height = Cm(2.1)
    c = doc.add_paragraph(style="Caption")
    c.alignment = WD_ALIGN_PARAGRAPH.CENTER
    c.add_run(caption)


def new_page(doc):
    doc.add_page_break()


def set_styles(doc):
    sec = doc.sections[0]
    sec.page_height, sec.page_width = Cm(29.7), Cm(21)
    sec.top_margin = Cm(2.3)
    sec.bottom_margin = Cm(2.2)
    sec.left_margin = Cm(3.0)
    sec.right_margin = Cm(2.1)

    normal = doc.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal.font.size = Pt(12)
    normal.font.color.rgb = RGBColor(28, 31, 35)
    normal.paragraph_format.line_spacing = 1.2
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.first_line_indent = Cm(0.55)

    title = doc.styles["Title"]
    title.font.name = "Times New Roman"
    title.font.size = Pt(23)
    title.font.bold = True
    title.font.color.rgb = RGBColor(0, 0, 0)
    title.paragraph_format.space_after = Pt(20)

    h1s = doc.styles["Heading 1"]
    h1s.font.name = "Times New Roman"
    h1s.font.size = Pt(16)
    h1s.font.bold = True
    h1s.font.color.rgb = BLUE
    h1s.paragraph_format.space_before = Pt(14)
    h1s.paragraph_format.space_after = Pt(10)
    h1s.paragraph_format.keep_with_next = True
    h1s.paragraph_format.page_break_before = True

    h2s = doc.styles["Heading 2"]
    h2s.font.name = "Times New Roman"
    h2s.font.size = Pt(13)
    h2s.font.bold = True
    h2s.font.color.rgb = MID_BLUE
    h2s.paragraph_format.space_before = Pt(11)
    h2s.paragraph_format.space_after = Pt(5)
    h2s.paragraph_format.keep_with_next = True

    cap = doc.styles["Caption"]
    cap.font.name = "Times New Roman"
    cap.font.size = Pt(10)
    cap.font.italic = True
    cap.font.color.rgb = GRAY
    cap.paragraph_format.space_after = Pt(11)
    cap.paragraph_format.first_line_indent = Cm(0)

    for name in ("List Bullet", "List Number"):
        style = doc.styles[name]
        style.font.name = "Times New Roman"
        style.font.size = Pt(11.5)
        style.paragraph_format.space_after = Pt(3)
        style.paragraph_format.first_line_indent = Cm(0)

    footer = sec.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.add_run("Báo cáo môn học IoT  ·  ")
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), "PAGE")
    footer._p.append(field)
    for run in footer.runs:
        run.font.size = Pt(9)
        run.font.color.rgb = GRAY


def build():
    arch = architecture_figure()
    alert = alert_figure()
    buffer = buffer_figure()
    doc = Document()
    set_styles(doc)

    # Cover page: the student's identifying data are intentionally editable.
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(24)
    p.add_run("BỘ GIÁO DỤC VÀ ĐÀO TẠO\n").bold = True
    p.add_run("[TÊN TRƯỜNG]  ·  [KHOA / VIỆN]").bold = True
    for _ in range(3):
        doc.add_paragraph()
    p = doc.add_paragraph("BÁO CÁO MÔN HỌC INTERNET OF THINGS", style="Subtitle")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p = doc.add_paragraph("Thiết kế và mô phỏng hệ thống IoT giám sát chuỗi lạnh trong vận chuyển hàng hóa", style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph()
    t = add_table(doc, ["Thông tin", "Nội dung cần điền"], [
        ["Sinh viên thực hiện", "[HỌ VÀ TÊN]"],
        ["Mã số sinh viên / Lớp", "[MSSV] / [LỚP]"],
        ["Giảng viên hướng dẫn", "[HỌ VÀ TÊN GIẢNG VIÊN]"],
        ["Học phần", "Internet of Things"],
    ], [5.0, 10.0])
    p = doc.add_paragraph("Tháng 10 năm 2026")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(45)
    h1(doc, "TÓM TẮT")
    add_p(doc, "Đề tài xây dựng một hệ thống mô phỏng giám sát điều kiện vận chuyển hàng hóa chuỗi lạnh. Một ESP32 trong Wokwi thu thập nhiệt độ và độ ẩm từ năm cảm biến DHT22, theo dõi trạng thái cửa khoang và gắn tọa độ GPS mô phỏng. Dữ liệu được gửi qua MQTT tới Mosquitto; Backend Node.js xử lý, lưu trên SQL Server và cung cấp cho Dashboard React. Hệ thống hiển thị số đo trực tiếp, lịch sử chuyến xe, bản đồ hành trình và cảnh báo qua giao diện cùng Telegram Bot.")
    add_p(doc, "Điểm kỹ thuật chính gồm cảnh báo vượt ngưỡng và cảnh báo sớm theo xu hướng hồi quy tuyến tính; phát hiện cảm biến/thiết bị mất kết nối; lưu đệm tối đa 30 gói telemetry trong RAM khi mất mạng; xác nhận lệnh điều khiển bằng ACK từ ESP32; và gộp các lần đo bất thường thành một sự cố có thời điểm phục hồi. Phần dự báo là thuật toán tính trên chuỗi đo gần nhất, không sử dụng mô hình AI được huấn luyện hoặc bộ dữ liệu huấn luyện.")
    add_p(doc, "Báo cáo mô tả kiến trúc, thiết kế mạch và dữ liệu, cách triển khai từng thành phần, quy trình kiểm thử và giới hạn của mô phỏng. Các ảnh màn hình cần lấy từ phiên chạy thực tế được đánh dấu để bổ sung trước khi nộp.")
    p = doc.add_paragraph()
    p.add_run("Từ khóa: ").bold = True
    p.add_run("IoT, chuỗi lạnh, ESP32, DHT22, MQTT, cảnh báo sớm, Dashboard.")
    new_page(doc)

    p = doc.add_paragraph("MỤC LỤC")
    p.style = "Title"
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    toc_entries = [
        (0, "TÓM TẮT"),
        (1, "CHƯƠNG 1 TỔNG QUAN ĐỀ TÀI"),
        (2, "1.1 Bối cảnh và vấn đề"),
        (2, "1.2 Mục tiêu và phạm vi"),
        (2, "1.3 Phương pháp thực hiện"),
        (1, "CHƯƠNG 2 CƠ SỞ LÝ THUYẾT VÀ YÊU CẦU"),
        (2, "2.1 Công nghệ sử dụng"),
        (2, "2.2 Yêu cầu hệ thống"),
        (1, "CHƯƠNG 3 PHÂN TÍCH VÀ THIẾT KẾ"),
        (2, "3.1 Kiến trúc tổng thể"),
        (2, "3.2 Mạch mô phỏng và sơ đồ chân"),
        (2, "3.3 Giao thức MQTT và cấu trúc dữ liệu"),
        (2, "3.4 Thiết kế cơ sở dữ liệu"),
        (1, "CHƯƠNG 4 TRIỂN KHAI HỆ THỐNG"),
        (2, "4.1 Firmware ESP32"),
        (2, "4.2 Lưu đệm và gửi lại dữ liệu"),
        (2, "4.3 Backend, cảnh báo và lưu dữ liệu"),
        (2, "4.4 Dashboard và điều khiển chuyến"),
        (1, "CHƯƠNG 5 KIỂM THỬ VÀ ĐÁNH GIÁ"),
        (2, "5.1 Môi trường và kịch bản kiểm thử"),
        (2, "5.2 Kết quả cần đối chiếu"),
        (2, "5.3 Giới hạn và hướng cải tiến"),
        (1, "KẾT LUẬN"),
        (1, "TÀI LIỆU THAM KHẢO"),
        (1, "PHỤ LỤC"),
    ]
    rendered_pdf = OUT_DIR / "qa_render" / "Bao_cao_mon_IoT_giam_sat_chuoi_lanh.pdf"
    if rendered_pdf.exists():
        from pypdf import PdfReader
        pages = [" ".join((page.extract_text() or "").split()) for page in PdfReader(str(rendered_pdf)).pages]
        PAGE_MAP["TÓM TẮT"] = 2
        for _, text in toc_entries:
            if text == "TÓM TẮT":
                continue
            for index, page_text in enumerate(pages[3:], start=4):
                if text in page_text:
                    PAGE_MAP[text] = index
                    break
    for level, text in toc_entries:
        p = doc.add_paragraph()
        p.paragraph_format.first_line_indent = Cm(0)
        p.paragraph_format.left_indent = Cm(0.7 if level == 2 else 0)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.tab_stops.add_tab_stop(Cm(15.8), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
        r = p.add_run(text)
        if level == 1:
            r.bold = True
        p.add_run("\t" + str(PAGE_MAP.get(text, "·")))

    p = doc.add_paragraph("DANH MỤC HÌNH VÀ BẢNG")
    p.style = "Heading 2"
    for line in [
        "Hình 3.1 Kiến trúc hệ thống giám sát chuỗi lạnh",
        "Hình 4.1 Cơ chế lưu đệm và gửi lại telemetry",
        "Hình 4.2 Vòng đời cảnh báo theo sự cố",
        "Hình 3.2 Ảnh mạch Wokwi cần bổ sung",
        "Hình 4.3 Ảnh Dashboard và bản đồ cần bổ sung",
    ]:
        p = doc.add_paragraph(line)
        p.paragraph_format.first_line_indent = Cm(0)
        p.paragraph_format.space_after = Pt(2)
    h1(doc, "CHƯƠNG 1 TỔNG QUAN ĐỀ TÀI")
    h2(doc, "1.1 Bối cảnh và vấn đề")
    add_p(doc, "Hàng hóa cần bảo quản lạnh có thể giảm chất lượng nếu nhiệt độ khoang vận chuyển vượt giới hạn trong một khoảng thời gian. Chỉ ghi nhiệt độ lúc giao và nhận hàng không cho biết sự cố xảy ra ở đâu, kéo dài bao lâu hoặc cửa khoang đã được mở trong điều kiện nào. Một hệ thống IoT có thể thu thập số đo định kỳ, lưu dấu thời gian và cảnh báo khi xuất hiện bất thường.")
    add_p(doc, "Đề tài mô phỏng một xe vận chuyển với năm vùng đo nhiệt độ/độ ẩm. Việc chia vùng giúp quan sát chênh lệch gần dàn lạnh, trung tâm, gần cửa và khu vực dự phòng. Cửa khoang được mô phỏng bằng nút nhấn; tọa độ xe dùng một tuyến điểm giả lập tại Thành phố Hồ Chí Minh. Các quyết định giám sát được thể hiện trên Dashboard và qua thông báo Telegram.")
    h2(doc, "1.2 Mục tiêu và phạm vi")
    add_bullet(doc, "Thu thập năm cặp nhiệt độ, độ ẩm từ DHT22 theo chu kỳ 4 giây và gửi bản tin MQTT có mã định danh.")
    add_bullet(doc, "Hiển thị vị trí xe, hành trình, biểu đồ, trạng thái thiết bị và các cảnh báo trên Dashboard.")
    add_bullet(doc, "Cảnh báo khi vượt ngưỡng, xu hướng sắp chạm ngưỡng, cửa mở trái phép/quá lâu và mất kết nối.")
    add_bullet(doc, "Cho phép khởi tạo chuyến, đặt ngưỡng bảo quản và bật/tắt Delivery Mode; ESP32 gửi ACK sau khi áp dụng lệnh.")
    add_bullet(doc, "Duy trì lấy mẫu và lưu telemetry tạm thời khi Wi-Fi/MQTT ngắt, sau đó phát lại theo thứ tự.")
    add_p(doc, "Phạm vi là mô phỏng trên Wokwi, chưa triển khai trên xe tải và cảm biến vật lý. GPS là tọa độ giả lập chứ không lấy vị trí từ máy tính. Thuật toán cảnh báo sớm dựa trên hồi quy tuyến tính của các điểm đo gần nhất; không có tập dữ liệu huấn luyện hay quá trình train mô hình.")
    h2(doc, "1.3 Phương pháp thực hiện")
    add_p(doc, "Nhóm chức năng được triển khai theo dòng dữ liệu từ thiết bị tới người giám sát: thiết kế mạch, lập trình firmware, cấu hình broker MQTT, xây Backend và cơ sở dữ liệu, sau đó xây Dashboard và kịch bản demo. Việc đối chiếu được thực hiện bằng Serial Monitor, bản tin MQTT, API, dữ liệu SQL và giao diện. Chương 5 cung cấp biểu mẫu ghi kết quả thực nghiệm để hoàn thiện khi chạy toàn bộ hệ thống.")

    h1(doc, "CHƯƠNG 2 CƠ SỞ LÝ THUYẾT VÀ YÊU CẦU")
    h2(doc, "2.1 Công nghệ sử dụng")
    add_p(doc, "ESP32 là vi điều khiển có kết nối Wi-Fi, phù hợp vai trò nút thu thập dữ liệu tại phương tiện. Trong project, ESP32 dùng Arduino framework và thư viện DHTesp để đọc DHT22, PubSubClient để giao tiếp MQTT và ArduinoJson để tạo bản tin JSON. Wokwi cung cấp môi trường mô phỏng mạch và thay đổi giá trị cảm biến khi demo [1].")
    add_p(doc, "MQTT dùng mô hình publish/subscribe: ESP32 gửi telemetry, trạng thái và cảnh báo lên các topic riêng; Backend nhận qua Mosquitto. Broker dùng tài khoản và ACL để giới hạn quyền đọc/ghi topic [2]. Backend dùng Node.js/Express và SQL Server; Dashboard dùng React/Vite, React Leaflet và bản đồ OpenStreetMap [3], [4]. Telegram Bot API cung cấp kênh thông báo khi phát hiện sự cố [5].")
    add_table(doc, ["Thành phần", "Vai trò trong project"], [
        ["ESP32 + Wokwi", "Thiết bị thu thập và mô phỏng mạch"],
        ["5 cảm biến DHT22", "Đo nhiệt độ, độ ẩm tại năm vùng"],
        ["Mosquitto", "Broker MQTT và phân quyền ACL"],
        ["Node.js/Express", "Xử lý bản tin, API, cảnh báo và lệnh"],
        ["SQL Server", "Lưu chuyến, telemetry và vòng đời sự cố"],
        ["React/Leaflet", "Dashboard và bản đồ hành trình"],
        ["Telegram Bot", "Thông báo cảnh báo từ Backend"],
    ], [4.0, 11.0])
    h2(doc, "2.2 Yêu cầu hệ thống")
    add_table(doc, ["Mã", "Yêu cầu chức năng", "Đầu ra cần quan sát"], [
        ["F01", "Lấy mẫu S1–S5 và trạng thái cửa", "Serial, telemetry MQTT"],
        ["F02", "Giám sát trực tiếp và lịch sử", "Dashboard, API, SQL"],
        ["F03", "Cảnh báo nhiệt độ, cửa và offline", "Danh sách sự cố, Telegram"],
        ["F04", "Điều khiển chuyến và Delivery Mode", "Command và ACK"],
        ["F05", "Lưu đệm khi mất mạng", "Ring Buffer, gói isBuffered"],
        ["F06", "Theo dõi hành trình", "Bản đồ và polyline"],
    ], [1.4, 7.3, 6.3])
    add_p(doc, "Yêu cầu phi chức năng được giới hạn theo khả năng mô phỏng: giao diện cần cho thấy mẫu mới mà không phải tải lại trang; sự cố phải được gộp để không tạo một dòng mới mỗi chu kỳ; dữ liệu không được ghi trùng khi gửi lại cùng messageId; mật khẩu MQTT và Telegram không lưu trong mã nguồn công khai. MQTT QoS 0 và Ring Buffer RAM không bảo đảm giao hàng tuyệt đối hoặc tồn tại qua mất nguồn.")

    h1(doc, "CHƯƠNG 3 PHÂN TÍCH VÀ THIẾT KẾ")
    h2(doc, "3.1 Kiến trúc tổng thể")
    add_p(doc, "Luồng chính bắt đầu ở ESP32. Thiết bị đo nhiệt độ/độ ẩm, cửa và tọa độ mô phỏng, đóng gói JSON rồi publish tới Mosquitto. Backend subscribe, kiểm tra payload, lưu packet và năm bản ghi cảm biến trong transaction SQL, đồng thời phát mẫu hợp lệ qua Server-Sent Events để Dashboard cập nhật nhanh. Dashboard cũng tải trạng thái và lịch sử từ REST API mỗi 5 giây. Khi sự cố bắt đầu, Backend có thể gửi Telegram.")
    image_with_caption(doc, arch, "Hình 3.1. Kiến trúc hệ thống giám sát chuỗi lạnh")
    add_p(doc, "Chiều điều khiển đi từ Control Panel qua API Backend đến topic command. ESP32 chỉ trả ACK sau khi kiểm tra và áp dụng cấu hình. Backend so commandId và giá trị thực tế trong ACK trước khi báo thành công. Với QoS 0, nếu ACK thất lạc thì kết quả lệnh ở trạng thái chưa xác định; ACK xác nhận firmware áp dụng, không xác nhận mọi telemetry về sau đều được lưu.")
    h2(doc, "3.2 Mạch mô phỏng và sơ đồ chân")
    add_table(doc, ["Thiết bị", "Chân ESP32", "Chức năng"], [
        ["DHT22 S1–S5", "GPIO 13, 14, 25, 26, 27", "Nhiệt độ và độ ẩm 5 vùng; DATA có điện trở kéo lên 10 kΩ"],
        ["Nút cửa", "GPIO 32", "Nhấn giữ 5 giây để đổi OPEN/CLOSED; INPUT_PULLUP"],
        ["LED đỏ", "GPIO 18", "Cảnh báo tại thiết bị"],
        ["Buzzer", "GPIO 19", "Còi cảnh báo tại thiết bị"],
        ["LED xanh", "GPIO 23", "Trạng thái kết nối MQTT"],
    ], [4.0, 4.2, 6.8])
    add_p(doc, "Mạch thật được định nghĩa trong esp32/diagram.json. Mỗi DHT22 nối 3V3/GND, dây dữ liệu riêng và điện trở kéo lên. Nút cửa nối GPIO 32 với GND. Hai LED có điện trở hạn dòng 220 Ω. Người dùng thay đổi nhiệt độ từng DHT22 và thao tác nút cửa trực tiếp trên giao diện Wokwi.")
    image_placeholder(doc, "Hình 3.2. Sơ đồ mạch mô phỏng trong Wokwi", "Mở esp32/diagram.json trong VS Code, thu nhỏ để thấy đủ ESP32, 5 DHT22, nút Door, 2 LED và buzzer; chụp cửa sổ Diagram Editor.")
    h2(doc, "3.3 Giao thức MQTT và cấu trúc dữ liệu")
    add_table(doc, ["Topic", "Hướng", "Nội dung"], [
        [".../telemetry", "ESP32 → Backend", "Năm cảm biến, cửa, GPS, thời gian, messageId"],
        [".../alert", "ESP32 → Backend", "Cảnh báo cục bộ và trạng thái active/clear"],
        [".../status", "ESP32/LWT → Backend", "ONLINE hoặc OFFLINE"],
        [".../command", "Backend → ESP32", "Ngưỡng, chuyến, Delivery Mode, commandId"],
        [".../ack", "ESP32 → Backend", "APPLIED/REJECTED và cấu hình đã áp dụng"],
    ], [4.3, 3.7, 7.0])
    add_p(doc, "Các topic có tiền tố coldchain/v1/devices/{deviceId}. Một bản tin telemetry chứa deviceId, tripId, năm phần tử sensors, trạng thái cửa, latitude/longitude, timestamp và isBuffered. messageId theo thiết bị được giữ nguyên khi phát lại; SQL Server có unique index trên cặp device_id/message_id để bỏ qua bản tin trùng. MQTT status dùng Last Will and Testament để broker có thể phát OFFLINE khi thiết bị ngắt bất thường.")
    h2(doc, "3.4 Thiết kế cơ sở dữ liệu")
    add_p(doc, "ColdChainDB có 11 bảng chính. Nhóm nghiệp vụ gồm vehicles, products, storage_profiles, lots, trips và trip_lots; nhóm thiết bị gồm devices và sensors; nhóm dữ liệu thời gian gồm telemetry_packets, sensor_readings và alerts. Ngưỡng nhiệt độ thực tế được lưu trên chuyến, tách khỏi ngưỡng mặc định trong Storage Profile.")
    add_table(doc, ["Bảng", "Thông tin tiêu biểu"], [
        ["trips / storage_profiles", "Trạng thái chuyến, Delivery Mode, Tmin, Tmax, thời gian mở cửa"],
        ["telemetry_packets", "message_id, measured_at, GPS, cửa, is_buffered"],
        ["sensor_readings", "packet_id, sensor_id, nhiệt độ, độ ẩm, trạng thái"],
        ["alerts", "Loại sự cố, created_at, last_seen_at, occurrence_count, resolved_at, recovered_at"],
    ], [4.5, 10.5])
    add_p(doc, "Một packet liên kết với năm dòng sensor_readings. Cảnh báo được mở một lần theo khóa chuyến/thiết bị/cảm biến/loại sự cố. Khi bất thường kéo dài, Backend cập nhật cùng dòng và tăng occurrence_count. Khi điều kiện phục hồi, recovered_at được ghi và status chuyển RESOLVED. Nút Đã xử lý có thể đổi status trước khi phục hồi; sự cố không bị mở lại cho tới khi kết thúc thật sự.")

    h1(doc, "CHƯƠNG 4 TRIỂN KHAI HỆ THỐNG")
    h2(doc, "4.1 Firmware ESP32")
    add_p(doc, "Firmware dùng một vòng lặp không chặn kéo dài cho việc đọc nút, kiểm tra Wi-Fi/MQTT và lấy mẫu định kỳ. Mỗi 4 giây, chương trình đọc S1–S5; giá trị không đọc được được đánh dấu FAULT với temperature/humidity bằng null. Thời gian được đồng bộ qua NTP. Trước khi đồng bộ, payload dùng mốc sentinel 1970-01-01 và timeSynchronized=false, vì vậy mốc đó không được hiểu là thời gian đo thực.")
    add_p(doc, "Cửa khoang là nút nhấn thay cho cảm biến cửa vật lý. Mỗi lượt giữ liên tục 5 giây làm trạng thái đổi một lần; phải thả nút trước lượt giữ tiếp theo. Khi chuyến IN_TRANSIT và Delivery Mode OFF, mở cửa tạo DOOR_BREACH. Cửa mở quá thời gian cấu hình, mặc định 30 giây, tạo DOOR_OPEN_TOO_LONG dù đang trong Delivery Mode. LED đỏ và buzzer báo động tại thiết bị.")
    add_p(doc, "GPS trong firmware là các tọa độ mô phỏng trên tuyến Thành phố Hồ Chí Minh, thay đổi theo bước thời gian. Dashboard hiển thị nguồn này trên OpenStreetMap; hệ thống không sử dụng GPS thật hoặc định vị máy tính. Cách mô phỏng giúp trình diễn tuyến xe nhưng chưa đánh giá độ chính xác vị trí ngoài thực tế.")
    h2(doc, "4.2 Lưu đệm và gửi lại dữ liệu")
    add_p(doc, "Nếu Wi-Fi hoặc MQTT không sẵn sàng, firmware tiếp tục giám sát tại chỗ và đưa payload vào Ring Buffer RAM 30 gói. Khi kết nối khôi phục, dữ liệu được gửi theo thứ tự FIFO với isBuffered=true rồi mới tiếp tục dữ liệu trực tiếp. Với nhịp lấy mẫu 4 giây, dung lượng danh nghĩa tương đương khoảng 2 phút; khi đầy, phần tử cũ nhất bị ghi đè. RAM không giữ dữ liệu qua reset hoặc mất điện. PubSubClient đang publish QoS 0 nên lệnh publish thành công chỉ cho biết thư viện chấp nhận gửi [2].")
    image_with_caption(doc, buffer, "Hình 4.1. Cơ chế lưu đệm và phát lại telemetry")
    h2(doc, "4.3 Backend, cảnh báo và lưu dữ liệu")
    add_p(doc, "Backend kiểm tra cấu trúc payload, số lượng và ID cảm biến, tọa độ và thời gian trước khi lưu. Transaction ghi telemetry_packets cùng năm sensor_readings và xử lý sự cố nhiệt độ. Sau khi commit, hệ thống cập nhật trạng thái last_seen. Mẫu trực tiếp được đẩy tới Dashboard qua /api/live để người dùng thấy số mới trước khi lịch sử SQL hoàn tất.")
    add_table(doc, ["Loại cảnh báo", "Điều kiện kích hoạt", "Điều kiện phục hồi"], [
        ["TEMPERATURE_EXCURSION", "Nhiệt độ ONLINE nằm ngoài Tmin–Tmax", "Mẫu ONLINE nằm lại trong khoảng"],
        ["EARLY_WARNING", "Xu hướng dự kiến chạm ngưỡng trong cửa sổ cảnh báo", "Mẫu ONLINE không còn thỏa xu hướng"],
        ["SENSOR_OFFLINE", "Quá timeout không nhận mẫu hợp lệ", "Cảm biến gửi mẫu ONLINE hợp lệ"],
        ["DEVICE_OFFLINE", "MQTT LWT OFFLINE hoặc quá timeout", "Thiết bị kết nối và gửi telemetry"],
        ["DOOR_BREACH", "Cửa mở khi giao hàng chưa được cho phép", "Firmware phát sự kiện clear"],
        ["DOOR_OPEN_TOO_LONG", "Cửa mở quá thời gian cho phép", "Firmware phát sự kiện clear"],
    ], [4.1, 5.7, 5.2])
    add_p(doc, "Cảnh báo sớm tính đường hồi quy tuyến tính từ tối thiểu ba điểm nhiệt độ có thời gian hợp lệ. Với nhiệt độ hiện tại T, hệ số dốc m và ngưỡng L, thời gian dự kiến chạm ngưỡng là (L − T)/m. Chỉ tạo cảnh báo nếu kết quả dương và không vượt quá earlyWarningMinutes. Đây là phép dự báo xu hướng ngắn hạn, không phải mô hình học máy được huấn luyện; nhiễu đo hoặc thay đổi đột ngột có thể làm dự báo sai.")
    add_p(doc, "Monitor nền quét khoảng 15 giây/lần; ngưỡng timeout mặc định 30 giây cho cảm biến và thiết bị. MQTT Last Will cung cấp tín hiệu offline sớm khi broker phát hiện mất kết nối. Backend chỉ gửi Telegram khi sự cố mới được mở; các lần đo bất thường tiếp theo tăng occurrence_count trên cùng cảnh báo. Khi có mẫu phục hồi, recovered_at được ghi. Cơ chế này giúp danh sách cảnh báo không tăng mỗi chu kỳ đo.")
    image_with_caption(doc, alert, "Hình 4.2. Vòng đời cảnh báo theo sự cố")
    h2(doc, "4.4 Dashboard và điều khiển chuyến")
    add_p(doc, "Dashboard React hiển thị KPI nhiệt độ/độ ẩm, trạng thái cửa, năm thẻ cảm biến, biểu đồ theo thời gian, lịch sử bản tin và danh sách cảnh báo. Bản đồ dùng React Leaflet và OpenStreetMap, vẽ polyline từ routeHistory và đặt marker tại vị trí xe hiện tại. Bản đồ không cần API key, nhưng tile công cộng phải giữ attribution và tuân thủ chính sách sử dụng [3], [4].")
    add_p(doc, "Control Panel có form chọn lô hàng, Storage Profile và chỉnh Tmin/Tmax trước khi bắt đầu chuyến. Nút Delivery Mode cho phép xác định lúc giao hàng hợp lệ. Lệnh đi qua Backend đến topic command với commandId; ESP32 kiểm tra cấu hình rồi trả ACK APPLIED hoặc REJECTED kèm giá trị đã áp dụng. Backend chờ tối đa 25 giây và chỉ trả thành công sau ACK khớp. Nếu không nhận ACK, giao diện thông báo trạng thái chưa xác định thay vì khẳng định thiết bị đã áp dụng.")
    image_placeholder(doc, "Hình 4.3. Dashboard tổng quan và bản đồ hành trình", "Chạy Backend + Frontend + Wokwi, mở http://localhost:5173; chụp Dashboard sao cho thấy KPI, cảm biến, biểu đồ và bản đồ. Có thể chụp hai ảnh nếu màn hình không đủ cao.")
    image_placeholder(doc, "Hình 4.4. Cảnh báo trên Dashboard và Telegram", "Tạo một sự cố nhiệt độ S1 > Tmax; chụp danh sách cảnh báo có occurrence_count và tin nhắn Telegram tương ứng. Che bot token/chat ID trước khi chèn ảnh.")

    h1(doc, "CHƯƠNG 5 KIỂM THỬ VÀ ĐÁNH GIÁ")
    h2(doc, "5.1 Môi trường và kịch bản kiểm thử")
    add_p(doc, "Môi trường demo gồm SQL Server, Mosquitto, Backend Node.js, Frontend React/Vite và ESP32 mô phỏng trong Wokwi. Mỗi kịch bản nên ghi đồng thời trạng thái Serial Monitor, bản tin MQTT, dữ liệu trên Dashboard và nếu có thì thông báo Telegram. Bảng dưới là quy trình đối chiếu; cột kết quả thực tế để điền sau khi chạy demo, tránh suy diễn từ việc mã nguồn đã tồn tại.")
    add_table(doc, ["TC", "Thao tác", "Kết quả mong đợi", "Thực tế"], [
        ["01", "Để S1–S5 khoảng 4–5°C, cửa đóng", "Năm cảm biến ONLINE, không phát cảnh báo", "[Điền]"],
        ["02", "Tăng S1 lên 9°C khi Tmax = 8°C", "Một TEMPERATURE_EXCURSION đang mở; count tăng; Telegram gửi một lần", "[Điền]"],
        ["03", "Đưa S1 về 5.5°C", "Cảnh báo có recovered_at, chuyển Đã xử lý / phục hồi", "[Điền]"],
        ["04", "Delivery Mode OFF, giữ Door 5 giây", "Cửa OPEN, DOOR_BREACH, LED/còi hoạt động", "[Điền]"],
        ["05", "Delivery Mode ON, mở cửa dưới 30 giây", "Không có DOOR_BREACH", "[Điền]"],
        ["06", "Giữ cửa OPEN hơn 30 giây", "DOOR_OPEN_TOO_LONG", "[Điền]"],
        ["07", "WIFI_OFF rồi WIFI_ON", "Buffer tăng, sau đó gửi lại isBuffered=true", "[Điền]"],
        ["08", "SENSOR_FAIL S2 rồi khôi phục", "S2 FAULT/OFFLINE rồi ONLINE; có mốc phục hồi", "[Điền]"],
        ["09", "Bật Delivery Mode trên Dashboard", "Serial và Backend có ACK APPLIED cùng commandId", "[Điền]"],
    ], [1.0, 4.4, 7.6, 2.0])
    h2(doc, "5.2 Kết quả cần đối chiếu")
    add_p(doc, "Firmware đã có các log phục vụ kiểm tra: Wi-Fi connected, MQTT connected, bản tin telemetry, số phần tử Ring Buffer, MQTT command received và Command ACK APPLIED/REJECTED. Một thay đổi nhiệt độ chỉ được xem là đi hết luồng khi Serial hiển thị giá trị mới, Backend nhận bản tin và Dashboard đổi số tương ứng. Khi đo độ trễ, ghi giờ tại từng điểm này bằng cùng một đồng hồ để tránh nhầm với timestamp mô phỏng của Wokwi.")
    add_table(doc, ["Bằng chứng", "Thông tin cần giữ trong ảnh/log"], [
        ["Ảnh Wokwi", "Toàn bộ 5 DHT22, chân GPIO, nút Door và LED/buzzer"],
        ["Serial Monitor", "Giá trị cảm biến, MQTT ONLINE, Ring Buffer và ACK"],
        ["Dashboard", "Nhiệt độ hiện tại, biểu đồ, bản đồ, cảnh báo"],
        ["Telegram", "Một tin lúc sự cố bắt đầu; không lặp theo từng mẫu"],
        ["SQL hoặc API", "alert_id, occurrence_count, created_at, recovered_at"],
    ], [4.0, 11.0])
    add_p(doc, "Không điền số liệu độ trễ hoặc tỷ lệ mất gói nếu chưa đo. Kết quả kiểm thử cuối cùng nên nêu số lần lặp, thời gian quan sát và các sai lệch so với mong đợi. Riêng EARLY_WARNING phụ thuộc dãy nhiệt độ gần nhất và hệ số dốc; nên tăng hoặc giảm cảm biến từng bước, thay vì nhảy ngay qua ngưỡng.")
    h2(doc, "5.3 Giới hạn và hướng cải tiến")
    add_bullet(doc, "GPS, nút cửa và cảm biến hiện là phần mô phỏng; khi triển khai thực cần cảm biến cửa và bộ định vị thật, hiệu chuẩn các vùng DHT22.")
    add_bullet(doc, "Ring Buffer nằm trong RAM, chỉ có 30 gói và mất khi thiết bị reset; có thể chuyển sang lưu bền vững hoặc tăng dung lượng khi cần.")
    add_bullet(doc, "MQTT QoS 0 có thể mất command, telemetry hoặc ACK. Cần cơ chế giao nhận mạnh hơn nếu áp dụng cho vận hành thực.")
    add_bullet(doc, "Dự báo tuyến tính dựa trên ít điểm đo có thể dao động; cần đánh giá bằng dữ liệu chuyến thật trước khi xem là dự báo tin cậy.")
    add_bullet(doc, "Bản đồ hiện lấy số điểm từ API giới hạn khoảng 200 packet khi mỗi packet có năm reading; chuyến dài cần phân trang hoặc API tuyến đường riêng.")

    h1(doc, "KẾT LUẬN")
    add_p(doc, "Project đã hình thành một luồng giám sát IoT hoàn chỉnh ở mức mô phỏng: ESP32 đo nhiều vùng, MQTT chuyển bản tin, Backend lưu và phân tích, Dashboard hiển thị trực tiếp và Telegram thông báo sự cố. Lệnh điều khiển có ACK để phân biệt đã gửi và đã áp dụng; cảnh báo được quản lý theo vòng đời thay vì tạo dòng lặp mỗi lần đo. Mô phỏng hỗ trợ trình bày các tình huống bình thường, vượt ngưỡng, mở cửa, mất mạng, lỗi cảm biến và khôi phục.")
    add_p(doc, "Bước tiếp theo là hoàn tất ảnh và bảng kết quả kiểm thử từ một phiên demo thống nhất, đo độ trễ thực tế và đối chiếu các giới hạn QoS 0. Trước khi triển khai trên phương tiện thật, cần bổ sung GPS/cảm biến cửa vật lý, lưu đệm bền vững và đánh giá độ tin cậy của cảnh báo sớm trên dữ liệu thực.")

    h1(doc, "TÀI LIỆU THAM KHẢO")
    references = [
        "[1] Espressif Systems, Arduino ESP32 Wi-Fi API, https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html (truy cập 13/10/2026).",
        "[2] Eclipse Mosquitto, mosquitto.conf manual, https://www.mosquitto.org/man/mosquitto-conf-5.html (truy cập 13/10/2026).",
        "[3] React Leaflet, Installation, https://react-leaflet.js.org/docs/start-installation/ (truy cập 13/10/2026).",
        "[4] OpenStreetMap Foundation, Tile Usage Policy, https://operations.osmfoundation.org/policies/tiles/ (truy cập 13/10/2026).",
        "[5] Telegram, Bot API, https://core.telegram.org/bots/api (truy cập 13/10/2026).",
        "[6] Mã nguồn project Smart Cold Chain IoT: esp32/, backend/, frontend/, database/, mqtt/ và docs/ (phiên bản dùng để viết báo cáo, 13/10/2026).",
    ]
    for line in references:
        p = doc.add_paragraph(line)
        p.paragraph_format.first_line_indent = Cm(0)
        p.paragraph_format.left_indent = Cm(0.7)

    h1(doc, "PHỤ LỤC")
    h2(doc, "Phụ lục A Ảnh cần chụp trước khi nộp")
    add_table(doc, ["Mã ảnh", "Chụp ở đâu", "Yêu cầu thể hiện"], [
        ["A1", "Wokwi Diagram Editor", "Đủ ESP32, 5 DHT22, Door, LED, buzzer; thay Hình 3.2"],
        ["A2", "Wokwi Simulator + Serial", "MQTT ONLINE, năm giá trị, một bản tin JSON"],
        ["A3", "Dashboard Tổng quan", "KPI, biểu đồ, năm cảm biến; thay Hình 4.3"],
        ["A4", "Dashboard Bản đồ GPS", "Marker xe và đường đi; bổ sung vào Hình 4.3"],
        ["A5", "Dashboard Cảnh báo", "Một incident S1, số lần ghi nhận và mốc phục hồi; thay Hình 4.4"],
        ["A6", "Telegram Bot", "Tin cảnh báo tương ứng; che token/chat ID; thay Hình 4.4"],
        ["A7", "Serial + Backend ACK", "Cùng commandId, trạng thái APPLIED"],
    ], [1.5, 5.0, 8.5])
    h2(doc, "Phụ lục B Hướng dẫn chạy tóm tắt")
    for step in [
        "1. Khởi động SQL Server và bảo đảm đã chạy schema.sql, seed.sql, migration cảnh báo.",
        "2. Khởi động Mosquitto với file cấu hình và tài khoản MQTT đã thiết lập.",
        "3. Chạy Backend Node.js tại backend/ và Frontend Vite tại frontend/.",
        "4. Build môi trường wokwi trong esp32/, bật Private IoT Gateway và chạy mô phỏng.",
        "5. Mở Dashboard, Serial Monitor TCP port 4000; thực hiện kịch bản và chụp bằng chứng.",
    ]:
        add_p(doc, step)
    add_p(doc, "Thông tin cấu hình chi tiết nằm trong docs/run-project.md. Không đưa backend/.env, esp32/secrets.h hoặc token Telegram vào ảnh chụp và bản nộp.")

    doc.core_properties.title = "Thiết kế và mô phỏng hệ thống IoT giám sát chuỗi lạnh"
    doc.core_properties.subject = "Báo cáo môn học Internet of Things"
    doc.core_properties.author = "Sinh viên thực hiện"
    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    build()
