param(
  [string]$OutputDir = "build/icons"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$output = Join-Path $root $OutputDir
New-Item -ItemType Directory -Force -Path $output | Out-Null

$code = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Text;

public static class CommercialIconBuilder
{
    private sealed class IconImage
    {
        public int Size;
        public byte[] Data;
    }

    private sealed class IcnsEntry
    {
        public string Type;
        public int Size;

        public IcnsEntry(string type, int size)
        {
            Type = type;
            Size = size;
        }
    }

    public static void Generate(string output)
    {
        Directory.CreateDirectory(output);
        int[] sizes = new[] { 16, 24, 32, 48, 64, 128, 256, 512, 1024 };

        foreach (int size in sizes)
        {
            using (Bitmap bitmap = DrawIcon(size))
            {
                SavePng(bitmap, Path.Combine(output, size + "x" + size + ".png"));
                if (size == 1024)
                {
                    SavePng(bitmap, Path.Combine(output, "icon.png"));
                }
            }
        }

        MakeIco(Path.Combine(output, "icon.ico"), output, new[] { 16, 24, 32, 48, 64, 128, 256 });
        MakeIcns(Path.Combine(output, "icon.icns"), output, new[]
        {
            new IcnsEntry("icp4", 16),
            new IcnsEntry("icp5", 32),
            new IcnsEntry("icp6", 64),
            new IcnsEntry("ic07", 128),
            new IcnsEntry("ic08", 256),
            new IcnsEntry("ic09", 512),
            new IcnsEntry("ic10", 1024),
            new IcnsEntry("ic11", 32),
            new IcnsEntry("ic12", 64),
            new IcnsEntry("ic13", 256),
            new IcnsEntry("ic14", 512)
        });
    }

    private static Bitmap DrawIcon(int size)
    {
        Bitmap bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.CompositingQuality = CompositingQuality.HighQuality;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            graphics.Clear(Color.Transparent);
            graphics.ScaleTransform(size / 1024f, size / 1024f);

            for (int i = 12; i >= 1; i--)
            {
                int alpha = Math.Max(4, 28 - (i * 2));
                using (Brush shadowBrush = new SolidBrush(Color.FromArgb(alpha, 4, 22, 18)))
                using (GraphicsPath shadowPath = RoundedRect(72 + i * 1.8f, 78 + i * 2.4f, 880, 880, 214))
                {
                    graphics.FillPath(shadowBrush, shadowPath);
                }
            }

            using (GraphicsPath appPath = RoundedRect(64, 56, 896, 896, 220))
            using (LinearGradientBrush bgBrush = new LinearGradientBrush(
                new RectangleF(64, 56, 896, 896),
                Color.FromArgb(255, 29, 210, 144),
                Color.FromArgb(255, 23, 106, 212),
                LinearGradientMode.ForwardDiagonal))
            {
                graphics.FillPath(bgBrush, appPath);
            }

            using (GraphicsPath overlayPath = RoundedRect(88, 84, 848, 848, 194))
            {
                using (LinearGradientBrush overlayBrush = new LinearGradientBrush(
                    new RectangleF(88, 84, 848, 848),
                    Color.FromArgb(92, 255, 255, 255),
                    Color.FromArgb(0, 255, 255, 255),
                    LinearGradientMode.Vertical))
                {
                    graphics.FillPath(overlayBrush, overlayPath);
                }

                using (Pen highlightPen = new Pen(Color.FromArgb(72, 255, 255, 255), 18))
                {
                    graphics.DrawPath(highlightPen, overlayPath);
                }
            }

            using (GraphicsPath bubblePath = ChatBubble(214, 252, 596, 414, 112))
            {
                using (Brush bubbleShadow = new SolidBrush(Color.FromArgb(54, 0, 0, 0)))
                {
                    graphics.TranslateTransform(0, 18);
                    graphics.FillPath(bubbleShadow, bubblePath);
                    graphics.TranslateTransform(0, -18);
                }

                using (Brush bubbleBrush = new SolidBrush(Color.FromArgb(250, 255, 255, 255)))
                {
                    graphics.FillPath(bubbleBrush, bubblePath);
                }
            }

            using (FontFamily family = GetFontFamily())
            using (Font font = new Font(family, 290, FontStyle.Bold, GraphicsUnit.Pixel))
            using (LinearGradientBrush textBrush = new LinearGradientBrush(
                new RectangleF(320, 280, 388, 360),
                Color.FromArgb(255, 0, 150, 103),
                Color.FromArgb(255, 22, 91, 194),
                LinearGradientMode.ForwardDiagonal))
            using (StringFormat format = new StringFormat())
            {
                format.Alignment = StringAlignment.Center;
                format.LineAlignment = StringAlignment.Center;
                graphics.DrawString("\u90BB", font, textBrush, new RectangleF(288, 278, 448, 348), format);
            }

            using (Brush accentBrush = new SolidBrush(Color.FromArgb(255, 255, 203, 82)))
            {
                FillPill(graphics, accentBrush, 278, 724, 92, 28);
                FillPill(graphics, accentBrush, 430, 748, 168, 28);
                FillPill(graphics, accentBrush, 654, 724, 92, 28);
            }
        }

        return bitmap;
    }

    private static FontFamily GetFontFamily()
    {
        try
        {
            return new FontFamily("Microsoft YaHei UI");
        }
        catch
        {
            return new FontFamily("Arial");
        }
    }

    private static void FillPill(Graphics graphics, Brush brush, float x, float y, float width, float height)
    {
        using (GraphicsPath path = RoundedRect(x, y, width, height, height / 2f))
        {
            graphics.FillPath(brush, path);
        }
    }

    private static GraphicsPath RoundedRect(float x, float y, float width, float height, float radius)
    {
        GraphicsPath path = new GraphicsPath();
        float diameter = radius * 2f;
        path.AddArc(x, y, diameter, diameter, 180, 90);
        path.AddArc(x + width - diameter, y, diameter, diameter, 270, 90);
        path.AddArc(x + width - diameter, y + height - diameter, diameter, diameter, 0, 90);
        path.AddArc(x, y + height - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static GraphicsPath ChatBubble(float x, float y, float width, float height, float radius)
    {
        GraphicsPath path = RoundedRect(x, y, width, height, radius);
        path.AddPolygon(new[]
        {
            new PointF(x + 192, y + height - 18),
            new PointF(x + 254, y + height + 84),
            new PointF(x + 338, y + height - 18)
        });
        path.CloseFigure();
        return path;
    }

    private static void SavePng(Bitmap bitmap, string path)
    {
        bitmap.Save(path, ImageFormat.Png);
    }

    private static void MakeIco(string path, string output, int[] sizes)
    {
        List<IconImage> images = new List<IconImage>();
        foreach (int size in sizes)
        {
            images.Add(new IconImage
            {
                Size = size,
                Data = File.ReadAllBytes(Path.Combine(output, size + "x" + size + ".png"))
            });
        }

        using (FileStream stream = new FileStream(path, FileMode.Create, FileAccess.Write))
        using (BinaryWriter writer = new BinaryWriter(stream))
        {
            WriteUInt16LE(writer, 0);
            WriteUInt16LE(writer, 1);
            WriteUInt16LE(writer, images.Count);
            int offset = 6 + (16 * images.Count);

            foreach (IconImage image in images)
            {
                byte dimension = image.Size >= 256 ? (byte)0 : (byte)image.Size;
                writer.Write(dimension);
                writer.Write(dimension);
                writer.Write((byte)0);
                writer.Write((byte)0);
                WriteUInt16LE(writer, 1);
                WriteUInt16LE(writer, 32);
                WriteUInt32LE(writer, image.Data.Length);
                WriteUInt32LE(writer, offset);
                offset += image.Data.Length;
            }

            foreach (IconImage image in images)
            {
                writer.Write(image.Data);
            }
        }
    }

    private static void MakeIcns(string path, string output, IcnsEntry[] entries)
    {
        List<IconImage> chunks = new List<IconImage>();
        List<string> types = new List<string>();

        foreach (IcnsEntry entry in entries)
        {
            string imagePath = Path.Combine(output, entry.Size + "x" + entry.Size + ".png");
            if (!File.Exists(imagePath))
            {
                continue;
            }

            types.Add(entry.Type);
            chunks.Add(new IconImage { Size = entry.Size, Data = File.ReadAllBytes(imagePath) });
        }

        int totalLength = 8;
        foreach (IconImage chunk in chunks)
        {
            totalLength += 8 + chunk.Data.Length;
        }

        using (FileStream stream = new FileStream(path, FileMode.Create, FileAccess.Write))
        using (BinaryWriter writer = new BinaryWriter(stream))
        {
            writer.Write(Encoding.ASCII.GetBytes("icns"));
            WriteUInt32BE(writer, totalLength);

            for (int i = 0; i < chunks.Count; i++)
            {
                writer.Write(Encoding.ASCII.GetBytes(types[i]));
                WriteUInt32BE(writer, 8 + chunks[i].Data.Length);
                writer.Write(chunks[i].Data);
            }
        }
    }

    private static void WriteUInt16LE(BinaryWriter writer, int value)
    {
        writer.Write((ushort)value);
    }

    private static void WriteUInt32LE(BinaryWriter writer, int value)
    {
        writer.Write((uint)value);
    }

    private static void WriteUInt32BE(BinaryWriter writer, int value)
    {
        byte[] bytes = BitConverter.GetBytes((uint)value);
        Array.Reverse(bytes);
        writer.Write(bytes);
    }
}
'@

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $code
[CommercialIconBuilder]::Generate($output)
Write-Host "Generated icon assets in $output"
